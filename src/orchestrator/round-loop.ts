import {
  Round1Schema,
  Round2PlusSchema,
  type Round1Output,
  type Round2PlusOutput,
} from '../shared/agent-output-schema.js';
import type { Adapter, EffortLevel } from '../shared/adapter.js';
import type { SceneConfig } from '../config/schemas/scenes.js';
import { buildRound1Prompt, buildRound2PlusPrompt } from './round-prompt.js';
import { buildPeerReviewRetrySuffix, validatePeerReview } from './peer-review-validate.js';

/**
 * Round loop 并行调度 + ERRORED 标记 + 拉黑。
 *
 * 来自 §roundtable-orchestrator "并行调度 + 错误隔离" + "错误处理矩阵" + "max_total_seconds 超时保护"
 * + tasks.md §9.3 / §9.4 / §9.7 / §9.9。
 *
 * Promise.allSettled 并行 spawn 所有 active agent 的 subprocess。任意 timeout / reject MUST NOT
 * 阻塞其他 agent。
 *
 * 错误处理矩阵（来自 §roundtable-orchestrator "错误处理矩阵"）：
 * - Adapter 报错 → 标该 agent 该 round ERRORED，继续
 * - JSON parse 失败 → 重试 1 次（带 parse error 反馈）；仍失败标 ERRORED（adapter 层已实现重试一次；
 *   本层在 catch InvokeError 后再尝试 1 次）
 * - peer_review 覆盖性 / agree-disagreement 逻辑校验失败 → 重试 1 次（带 completeness error 反馈）
 *   ；仍失败标 ERRORED
 * - 单 agent 连续 2 轮 ERRORED → 该 agent 本次 run 拉黑（由 blacklist 模块跟踪）
 * - max_total_seconds 超时 + abort_on_exceed=true → 当前轮结束后 abort 走 escape；
 *   abort_on_exceed=false → 仅 warn 不 abort
 */

export type AgentRoundOutput =
  | {
      agent: string;
      ok: true;
      round: 1;
      output: Round1Output;
      durationMs: number;
      usage: import('../shared/adapter.js').Usage | null;
    }
  | {
      agent: string;
      ok: true;
      round: number;
      output: Round2PlusOutput;
      durationMs: number;
      usage: import('../shared/adapter.js').Usage | null;
    }
  | { agent: string; ok: false; round: number; error: string; durationMs: number };

export interface RunRoundArgs {
  /** 当前轮号 */
  round: number;
  /** 本轮 active agents 集合 */
  activeAgents: readonly string[];
  /** name → Adapter 实例 */
  adapters: ReadonlyMap<string, Adapter>;
  /** 本次 run 的 effort 解析后映射（name → level） */
  effortMap: ReadonlyMap<string, EffortLevel>;
  /** 当前 scene */
  scene: SceneConfig;
  /** Enhancer 后的 enhanced_question */
  enhancedQuestion: string;
  /** resolved_output_language */
  resolvedOutputLanguage: string;
  /** 上一轮所有 agent 的 round 2+ output（Round 1 此参数应为空 map） */
  previousOutputs: ReadonlyMap<string, Round1Output | Round2PlusOutput>;
  /** 单 agent timeout（毫秒），按 models.<name>.timeout_s 注入 */
  timeoutMs: number;
  /**
   * 追问链（来自 §followup-rounds）。
   *
   * 仅 Round 1 注入；Round 2+ 不重复，因为 previousOutputs 已经携带 Round 1 的上下文。
   */
  priorChain?: readonly import('../persistence/followup.js').PriorChainEntry[];
}

export interface RunRoundResult {
  /** 每个 agent 的本轮结果（含 ERRORED） */
  results: AgentRoundOutput[];
  /** 本轮端到端耗时 */
  durationMs: number;
}

/**
 * 跑一个 round（并行所有 agent）。
 *
 * 不处理拉黑 / abort / 收敛——那些是 round_loop 外层（runRoundLoop）的事。
 */
export async function runRound(args: RunRoundArgs): Promise<RunRoundResult> {
  const start = Date.now();

  // 为每个 agent 构造 prompt + invoke
  const tasks: Promise<AgentRoundOutput>[] = [];
  for (const agent of args.activeAgents) {
    tasks.push(invokeOneAgent({ ...args, agent }));
  }

  const settled = await Promise.allSettled(tasks);
  const results: AgentRoundOutput[] = [];
  for (let i = 0; i < settled.length; i++) {
    const settledResult = settled[i]!;
    const agent = args.activeAgents[i]!;
    if (settledResult.status === 'fulfilled') {
      results.push(settledResult.value);
    } else {
      // 理论上 invokeOneAgent 会自己 catch 并返回 ok=false，不应进 rejected 分支
      // 但保险起见加 catch
      results.push({
        agent,
        ok: false,
        round: args.round,
        error: `unhandled rejection: ${
          settledResult.reason instanceof Error
            ? settledResult.reason.message
            : String(settledResult.reason)
        }`,
        durationMs: 0,
      });
    }
  }

  return { results, durationMs: Date.now() - start };
}

interface InvokeOneArgs extends RunRoundArgs {
  agent: string;
}

/**
 * 调用单个 agent 一轮，处理 schema 失败重试 + peer_review 校验失败重试。
 *
 * Round 1：仅 Round1Schema 校验。
 * Round 2+：Round2PlusSchema 校验 + peer_review 覆盖性 / agree-disagreements 校验；
 *           任一失败 → 重试 1 次（带对应 retry suffix）→ 仍失败标 ERRORED。
 */
async function invokeOneAgent(args: InvokeOneArgs): Promise<AgentRoundOutput> {
  const adapter = args.adapters.get(args.agent);
  if (adapter === undefined) {
    return {
      agent: args.agent,
      ok: false,
      round: args.round,
      error: `adapter "${args.agent}" 未注册`,
      durationMs: 0,
    };
  }

  const start = Date.now();
  const effort = args.effortMap.get(args.agent) ?? 'medium';
  const schema = args.round === 1 ? Round1Schema : Round2PlusSchema;
  const prompt = buildPrompt(args);

  // 第一次调用
  let parsed: unknown;
  let usage: import('../shared/adapter.js').Usage | null = null;
  try {
    const result = await adapter.invoke({
      prompt,
      schema,
      effort,
      timeoutMs: args.timeoutMs,
    });
    parsed = result.parsed;
    usage = result.usage;
  } catch (err) {
    // adapter 层失败（含 schema 单次失败）→ 用 buildRetrySuffix 重试一次
    const retryPrompt = prompt + buildSimpleRetrySuffix((err as Error).message);
    try {
      const retryResult = await adapter.invoke({
        prompt: retryPrompt,
        schema,
        effort,
        timeoutMs: args.timeoutMs,
      });
      parsed = retryResult.parsed;
      usage = retryResult.usage;
    } catch (err2) {
      return {
        agent: args.agent,
        ok: false,
        round: args.round,
        error: `adapter invoke 重试后仍失败：${(err2 as Error).message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  // Round 1：直接返回（schema 已通过 adapter 内部校验）
  if (args.round === 1) {
    return {
      agent: args.agent,
      ok: true,
      round: 1,
      output: parsed as Round1Output,
      durationMs: Date.now() - start,
      usage,
    };
  }

  // Round 2+：peer_review 覆盖性 + agree-disagreements 校验
  const output = parsed as Round2PlusOutput;
  const validation = validatePeerReview({
    output,
    selfAgent: args.agent,
    activeAgents: args.activeAgents,
  });
  if (validation.ok) {
    return {
      agent: args.agent,
      ok: true,
      round: args.round,
      output,
      durationMs: Date.now() - start,
      usage,
    };
  }

  // peer_review 失败 → 重试 1 次（带 retry suffix）
  const retryPrompt2 = prompt + buildPeerReviewRetrySuffix(validation);
  let retryParsed: unknown;
  let retryUsage: import('../shared/adapter.js').Usage | null = null;
  try {
    const retryResult = await adapter.invoke({
      prompt: retryPrompt2,
      schema,
      effort,
      timeoutMs: args.timeoutMs,
    });
    retryParsed = retryResult.parsed;
    retryUsage = retryResult.usage;
  } catch (err) {
    return {
      agent: args.agent,
      ok: false,
      round: args.round,
      error: `peer_review 重试 invoke 失败：${(err as Error).message}`,
      durationMs: Date.now() - start,
    };
  }

  // 重试后再校验一次 peer_review
  const retryOutput = retryParsed as Round2PlusOutput;
  const retryValidation = validatePeerReview({
    output: retryOutput,
    selfAgent: args.agent,
    activeAgents: args.activeAgents,
  });
  if (retryValidation.ok) {
    return {
      agent: args.agent,
      ok: true,
      round: args.round,
      output: retryOutput,
      durationMs: Date.now() - start,
      usage: retryUsage,
    };
  }

  return {
    agent: args.agent,
    ok: false,
    round: args.round,
    error: `peer_review 重试后仍失败：${retryValidation.message}`,
    durationMs: Date.now() - start,
  };
}

function buildPrompt(args: InvokeOneArgs): string {
  if (args.round === 1) {
    return buildRound1Prompt({
      enhancedQuestion: args.enhancedQuestion,
      scene: args.scene,
      resolvedOutputLanguage: args.resolvedOutputLanguage,
      priorChain: args.priorChain,
    });
  }
  // Round 2+：把 previousOutputs 转 string map
  const previousOutputs: Record<string, string> = {};
  for (const [agent, output] of args.previousOutputs) {
    previousOutputs[agent] = JSON.stringify(output, null, 2);
  }
  return buildRound2PlusPrompt({
    enhancedQuestion: args.enhancedQuestion,
    scene: args.scene,
    selfAgent: args.agent,
    round: args.round,
    previousOutputs,
    activeAgents: args.activeAgents,
    resolvedOutputLanguage: args.resolvedOutputLanguage,
  });
}

function buildSimpleRetrySuffix(errorMessage: string): string {
  return [
    '',
    '---',
    '',
    '上次输出处理失败。问题：',
    errorMessage,
    '',
    '请修正后**仅输出修正后的完整 JSON**（不要其他解释文本）。',
  ].join('\n');
}

/**
 * Blacklist 跟踪：单 agent 连续 ERRORED 轮数。
 *
 * 来自 §roundtable-orchestrator "错误处理矩阵" 单 agent 连续 2 轮 ERRORED 拉黑。
 *
 * 用法：runRoundLoop 在每轮结束后调用 updateBlacklistCounts 更新计数；
 * 调用 computeNewActiveAgents 取出本轮末尾的 active set（已移除拉黑 agent）。
 */
export class BlacklistTracker {
  /** agent → 连续 ERRORED 轮数 */
  private counts = new Map<string, number>();
  /** 已拉黑（不再加入 active 列表） */
  private blacklisted = new Set<string>();

  /**
   * 用本轮结果更新计数。
   * - ok=true → counter 重置为 0
   * - ok=false → counter+=1；>=2 → 加入 blacklisted
   */
  update(results: readonly AgentRoundOutput[]): void {
    for (const r of results) {
      if (this.blacklisted.has(r.agent)) continue;
      if (r.ok) {
        this.counts.set(r.agent, 0);
      } else {
        const prev = this.counts.get(r.agent) ?? 0;
        const next = prev + 1;
        this.counts.set(r.agent, next);
        if (next >= 2) {
          this.blacklisted.add(r.agent);
        }
      }
    }
  }

  /** 是否拉黑 */
  isBlacklisted(agent: string): boolean {
    return this.blacklisted.has(agent);
  }

  /** 取当前所有被拉黑的 agent（用于 events.jsonl / TUI 提示） */
  getBlacklisted(): readonly string[] {
    return [...this.blacklisted];
  }

  /** 从 active set 中移除被拉黑的 agent。 */
  filterActive(active: readonly string[]): string[] {
    return active.filter((a) => !this.blacklisted.has(a));
  }

  /** 仅测试 / debug 用 */
  getCount(agent: string): number {
    return this.counts.get(agent) ?? 0;
  }
}
