import type { LanguageState } from '../lang/types.js';
import type { UsageMatrix } from '../usage/aggregator.js';

/**
 * meta.json schema 实装。
 *
 * 来自 §persistence-history "meta.json schema" + tasks.md §17.1 + 跨阶段约束 #11。
 *
 * 双 schema：
 * - **multi_agent**：多 agent 圆桌（converged / escaped / aborted / cancelled）
 * - **single_agent**：direct / downgraded（single_agent_completed / aborted）
 *
 * outcome 枚举（持久化层；与事件层 data.outcome 不完全重叠）：
 * - converged / escaped / single_agent_completed / aborted
 * - **不**含 cancelled（cancelled 路径不落盘，不会出现在 meta.json）
 */

/** scene_source 4 值枚举（来自 §persistence-history meta.json schema）。 */
export type SceneSource =
  | 'auto' // Enhancer 检测 confidence >= 0.8
  | 'cli_override' // 用户显式 --scene
  | 'fallback_general' // confidence < 0.8 或 Layer 2 三重交集 == 0 fallback
  | 'forced_general_direct'; // 单 agent direct 路径专属

export type RunOutcome = 'converged' | 'escaped' | 'single_agent_completed' | 'aborted';

export type ExecutorMode = 'fixed' | 'rotate' | 'random' | 'per_scene';

/** 多 agent 路径 meta.json schema。 */
export interface MultiAgentMeta {
  run_id: string;
  schema_version: 1;
  path: 'multi_agent';
  /** root run 为 null；追问 run 为被追问的 run_id（来自 §followup-rounds） */
  parent_run_id: string | null;
  /** root=0；追问 run 累加 +1；冗余字段省每次 walk 链 */
  followup_depth: number;
  started_at: string;
  ended_at: string | null;
  raw_question: string;
  enhanced_question: string;
  scene: string;
  scene_source: 'auto' | 'cli_override' | 'fallback_general';
  scene_fallback_used: boolean;
  participants: string[];
  enhancer_model: string;
  executor_model: string | null;
  executor_mode: ExecutorMode;
  executor_fallback_used: boolean;
  original_executor_model: string | null;
  rounds_completed: number;
  outcome: 'converged' | 'escaped' | 'aborted';
  language: MetaLanguage;
  usage: UsageMatrix;
  usage_totals: Record<string, number> & { grand_total: number };
  adapter_versions: Record<string, string>;
  enhancer: {
    fallback_used: boolean;
    failure_reason?: 'adapter_errored' | 'json_parse_failed' | 'timeout';
  };
}

/** 单 agent 路径 meta.json schema。 */
export interface SingleAgentMeta {
  run_id: string;
  schema_version: 1;
  path: 'single_agent';
  single_agent_kind: 'direct' | 'downgraded';
  /** root run 为 null；追问 run 为被追问的 run_id（来自 §followup-rounds） */
  parent_run_id: string | null;
  /** root=0；追问 run 累加 +1 */
  followup_depth: number;
  started_at: string;
  ended_at: string | null;
  raw_question: string;
  /** direct 路径下为 null（未调 Enhancer） */
  enhanced_question: string | null;
  scene: string;
  scene_source: SceneSource;
  scene_fallback_used: boolean;
  participants: string[];
  /** direct 路径下为 null */
  enhancer_model: string | null;
  executor_model: null; // 单 agent 无 executor resolve
  executor_mode: null;
  executor_fallback_used: false; // 单 agent 无 fallback 概念
  original_executor_model: null;
  rounds_completed: 0;
  outcome: 'single_agent_completed' | 'aborted';
  language: MetaLanguage;
  usage: UsageMatrix;
  usage_totals: Record<string, number> & { grand_total: number };
  adapter_versions: Record<string, string>;
  enhancer: {
    /** direct 路径恒为 false（未调 Enhancer） */
    fallback_used: boolean;
  };
}

export type RunMeta = MultiAgentMeta | SingleAgentMeta;

/**
 * 读取持久化的 meta JSON 后做向后兼容补全。
 *
 * v0.1.0 写的 meta 没有 parent_run_id / followup_depth；视为 root run。
 */
export function normalizeMeta(raw: Record<string, unknown>): RunMeta {
  const out: Record<string, unknown> = { ...raw };
  if (out.parent_run_id === undefined) out.parent_run_id = null;
  if (out.followup_depth === undefined) out.followup_depth = 0;
  return out as unknown as RunMeta;
}

/** meta.json.language 段（来自 §language-support "持久化字段"，短形式字段名）。 */
export interface MetaLanguage {
  system: string;
  requested_output: string;
  resolved_output: string;
  resolved_ui: string;
  source: LanguageState['source'];
  confidence: number | null;
  fallback_used: boolean;
}

/**
 * 把内存 LanguageState 转 meta.json.language 形态。
 */
export function buildMetaLanguage(state: LanguageState): MetaLanguage {
  return {
    system: state.system,
    requested_output: state.requested_output,
    resolved_output: state.resolved_output,
    resolved_ui: state.resolved_ui,
    source: state.source,
    confidence: state.confidence,
    fallback_used: state.fallback_used,
  };
}

/**
 * redact_patterns 正则替换：落盘前对 raw_question / enhanced_question / agent answer 替换敏感片段。
 *
 * 来自 §security-privacy "敏感输入与持久化控制" + tasks.md §20.5.7。
 *
 * @param patterns  prefs.yaml.history.redact_patterns 数组
 * @returns 替换函数（接受 string → 返回 redacted string）
 */
export function buildRedactor(patterns: readonly string[]): (s: string | null) => string | null {
  if (patterns.length === 0) return (s) => s;
  const compiled: RegExp[] = [];
  for (const pat of patterns) {
    try {
      compiled.push(new RegExp(pat, 'g'));
    } catch {
      // 跳过非法正则
    }
  }
  return (s) => {
    if (s === null) return null;
    let result = s;
    for (const re of compiled) {
      result = result.replace(re, '[REDACTED]');
    }
    return result;
  };
}
