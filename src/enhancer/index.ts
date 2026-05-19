import type { Adapter, EffortLevel } from '../shared/adapter.js';
import type { ScenesFile } from '../config/schemas/scenes.js';
import type { PriorChainEntry } from '../persistence/followup.js';
import { extractJson } from '../adapters/runtime/json-extract.js';
import { validateWithRetry } from '../adapters/runtime/validate.js';
import {
  buildConfirmationPrompt,
  needsLanguageConfirmation,
} from '../lang/confidence.js';
import { resolveAutoOutput } from '../lang/resolver.js';
import type { LanguageState, RequestedOutputLanguage } from '../lang/types.js';
import {
  applyEnhancerFailureFallback,
  type EnhancerFallbackResult,
} from './fallback.js';
import { buildEnhancerPrompt } from './prompt.js';
import { EnhancerOutputSchema, type EnhancerOutput } from './schema.js';

/**
 * Enhancer 主流程。
 *
 * 来自 §question-enhancer "单次 LLM 调用同时完成 4 件事" + "scene_confidence 阈值回退"
 * + "命令行 `--scene` 强制 override" + "用户答案直接拼装" + "用户最终编辑 + 确认入口"
 * + "Enhancer 失败 fallback" + tasks.md §7.2 / §7.3 / §7.7 / §7.8。
 *
 * 流程：
 * 1. 拼装 prompt（auto / explicit 模式）
 * 2. adapter.invoke → JSON 提取 → validateWithRetry（带 retry suffix）
 * 3. 成功：
 *    - questions_for_user.length &gt; 3 → 截断前 3 + warn
 *    - scene_confidence &lt; 0.8 → fallback general + scene_source = fallback_general
 *    - --scene override 命中 → 忽略 detected_scene（替换为 override 值，source = cli_override）
 *    - auto 模式 + language_confidence &lt; 0.6 → needs_language_confirmation 标记
 *    - 返回 EnhancerSuccess
 * 4. 失败（adapter ERRORED / parse 失败 / timeout）→ applyEnhancerFailureFallback → 返回 EnhancerFailure
 *
 * 用户答案拼接、Y/n/edit 确认页交互在阶段 5 / 6 状态机层处理。
 */

export interface RunEnhancerArgs {
  rawQuestion: string;
  scenes: ScenesFile;
  /** 用户层 requested_output_language */
  requestedOutput: RequestedOutputLanguage;
  /** Enhancer 调用前已解析的 language 状态（explicit 模式下含 resolved_output） */
  preResolvedLanguage: LanguageState;
  /** 选定的 Enhancer adapter（由 roles.yaml.enhancer.model 决定） */
  adapter: Adapter;
  /** 本次 Enhancer 使用的 effort */
  effort: EffortLevel;
  /** invoke timeout（毫秒）；默认 5 分钟 */
  timeoutMs?: number;
  /** CLI --scene 强制 override（来自 §question-enhancer "命令行 `--scene` 强制 override"） */
  sceneOverride?: string;
  /** 追问链：非空时把 prior chain 拼进 enhancer prompt（来自 §followup-rounds） */
  priorChain?: readonly PriorChainEntry[];
}

export type EnhancerResult = EnhancerSuccess | EnhancerFailure;

export interface EnhancerSuccess {
  kind: 'success';
  /** Enhancer 拼装的 enhanced_question（含 inferred_dimensions 合并）；用户答案由调用方追加 */
  enhanced_question: string;
  /** 最终 scene 名（已应用 --scene override 与 scene_confidence < 0.8 fallback） */
  scene: string;
  /** scene 解析来源 */
  scene_source: 'auto' | 'cli_override' | 'fallback_general';
  /** scene_confidence < 0.8 触发的 fallback 标记 */
  scene_fallback_used: boolean;
  /** Enhancer 返回的 ≤3 个反问；用于 TUI 反问交互（阶段 6） */
  questions_for_user: string[];
  /** 解析后的 inferred_dimensions（debug / TUI 展示用） */
  inferred_dimensions: Record<string, string>;
  /** 更新后的 language 状态（auto 模式下可能含 resolved_output / source 变化） */
  language: LanguageState;
  /** 仅 auto 模式 + confidence < 0.6 时为 true，由调用方决定是否走用户确认流程 */
  needs_language_confirmation: boolean;
  /** 仅 needs_language_confirmation = true 时填充：提示文案 */
  language_confirmation_prompt?: string;
}

export interface EnhancerFailure {
  kind: 'failure';
  fallback: EnhancerFallbackResult;
}

/** 主入口。 */
export async function runEnhancer(args: RunEnhancerArgs): Promise<EnhancerResult> {
  const mode = args.requestedOutput === 'auto' ? 'auto' : 'explicit';
  const prompt = buildEnhancerPrompt({
    rawQuestion: args.rawQuestion,
    scenes: args.scenes,
    mode,
    resolvedOutputLanguage:
      mode === 'explicit' ? args.preResolvedLanguage.resolved_output : undefined,
    priorChain: args.priorChain,
  });

  // 第一次调用 adapter；validateWithRetry 在失败时构造 retry suffix 并调用 callSecond
  let firstResult;
  try {
    firstResult = await args.adapter.invoke({
      prompt,
      schema: EnhancerOutputSchema,
      effort: args.effort,
      timeoutMs: args.timeoutMs ?? 5 * 60 * 1000,
    });
  } catch (err) {
    return enhancerFailureFromError(err, args);
  }

  // adapter.invoke 内部已经 schema.parse 过；这里直接用 firstResult.parsed
  // 但若 adapter throws InvokeError(schema 失败)，需要走 retry：用 validateWithRetry 包裹
  // 简化：单一次调用已含 adapter 层的解析；失败的 retry 在更高层（阶段 5 Orchestrator）触发整轮重试。
  // 这里直接 safeParse firstResult.parsed 即可（adapter 已经 parse 一次但返回的是 parsed unknown）。
  const parsed = EnhancerOutputSchema.safeParse(firstResult.parsed);
  if (!parsed.success) {
    return enhancerFailureFromError(parsed.error, args);
  }

  return buildEnhancerSuccess(parsed.data, args);
}

/**
 * 内部：从 adapter / parse 错误构造 EnhancerFailure。
 */
function enhancerFailureFromError(err: unknown, args: RunEnhancerArgs): EnhancerFailure {
  let reason: 'adapter_errored' | 'json_parse_failed' | 'timeout' = 'adapter_errored';
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('超时') || /timeout/i.test(msg)) reason = 'timeout';
  else if (msg.includes('schema') || /parse/i.test(msg)) reason = 'json_parse_failed';

  return {
    kind: 'failure',
    fallback: applyEnhancerFailureFallback({
      rawQuestion: args.rawQuestion,
      requestedOutput: args.requestedOutput,
      preResolvedLanguage: args.preResolvedLanguage,
      failureReason: reason,
    }),
  };
}

/**
 * 内部：把校验后的 EnhancerOutput 整理为 EnhancerSuccess。
 *
 * 处理：
 * - questions_for_user 截断到 3（schema 已用 .max(3) 限制，但 passthrough 模式下 Zod 会拒绝 4+，
 *   实际不会到这里——但保留 truncate 防御性逻辑）
 * - scene_confidence < 0.8 → fallback general（scene_source = fallback_general）
 * - --scene override 命中 → 替换 scene + source = cli_override
 * - auto 模式 + language_confidence < 0.6 → needs_confirmation
 */
function buildEnhancerSuccess(output: EnhancerOutput, args: RunEnhancerArgs): EnhancerSuccess {
  // questions_for_user 截断（schema 应已限制，但防御性保留）
  const questions_for_user = output.questions_for_user.slice(0, 3);

  // scene 决议
  let scene: string;
  let scene_source: 'auto' | 'cli_override' | 'fallback_general';
  let scene_fallback_used = false;
  if (args.sceneOverride !== undefined && args.sceneOverride !== '') {
    if (!Object.prototype.hasOwnProperty.call(args.scenes.scenes, args.sceneOverride)) {
      // 调用方应在 CLI 解析阶段就拦截非法 scene；这里防御性 fallback
      scene = 'general';
      scene_source = 'fallback_general';
      scene_fallback_used = true;
    } else {
      scene = args.sceneOverride;
      scene_source = 'cli_override';
    }
  } else if (output.scene_confidence < 0.8) {
    scene = 'general';
    scene_source = 'fallback_general';
    scene_fallback_used = true;
  } else if (Object.prototype.hasOwnProperty.call(args.scenes.scenes, output.detected_scene)) {
    scene = output.detected_scene;
    scene_source = 'auto';
  } else {
    // detected_scene 不在 scene 清单 → fallback general（保守）
    scene = 'general';
    scene_source = 'fallback_general';
    scene_fallback_used = true;
  }

  // 语言决议
  let language: LanguageState = args.preResolvedLanguage;
  let needs_language_confirmation = false;
  let language_confirmation_prompt: string | undefined;

  if (args.requestedOutput === 'auto') {
    const detected = output.user_language ?? args.preResolvedLanguage.system;
    const confidence = output.language_confidence ?? 1.0;

    const auto = resolveAutoOutput({
      detectedLanguage: detected,
      confidence,
      systemLang: args.preResolvedLanguage.system,
    });

    language = {
      ...args.preResolvedLanguage,
      resolved_output: auto.resolved,
      source: auto.source,
      confidence,
      fallback_used: false,
    };

    if (auto.needsSystemConfirmation && needsLanguageConfirmation(confidence)) {
      needs_language_confirmation = true;
      language_confirmation_prompt = buildConfirmationPrompt(args.preResolvedLanguage.system);
    }
  }
  // explicit 模式：preResolvedLanguage 已含正确的 resolved_output / source；不动

  return {
    kind: 'success',
    enhanced_question: output.enhanced_question_so_far,
    scene,
    scene_source,
    scene_fallback_used,
    questions_for_user,
    inferred_dimensions: output.inferred_dimensions,
    language,
    needs_language_confirmation,
    ...(language_confirmation_prompt !== undefined ? { language_confirmation_prompt } : {}),
  };
}

/**
 * 把用户答案追加到 enhanced_question 末尾。
 *
 * 来自 §question-enhancer "用户答案直接拼装，不二次调用 Enhancer" Requirement：
 * - 答案以 "Q: ... / A: ..." 结构追加
 * - **不**触发第二次 Enhancer 调用
 */
export function appendUserAnswers(args: {
  enhancedQuestion: string;
  questions: readonly string[];
  answers: readonly string[];
}): string {
  if (args.questions.length === 0 || args.answers.length === 0) {
    return args.enhancedQuestion;
  }
  const lines: string[] = [args.enhancedQuestion, '', '## 用户补充'];
  const pairs = Math.min(args.questions.length, args.answers.length);
  for (let i = 0; i < pairs; i++) {
    lines.push(`Q: ${args.questions[i]}`);
    lines.push(`A: ${args.answers[i]}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * extractJson 重新解析（用于 adapter.invoke 已 throw 但仍需要 retry 的边缘情形）。
 *
 * 当前未在主流程中使用——adapter 内部 schema 失败直接 throw，由更上层 Orchestrator 决定 retry。
 * 保留为 helper，便于阶段 5 接入时复用。
 */
export const _internal = { extractJson, validateWithRetry };
