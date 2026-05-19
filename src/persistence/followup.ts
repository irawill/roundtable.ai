import { readdirSync } from 'node:fs';
import type { RunsIo } from './runs.js';
import type { RunMeta } from './meta.js';
import { isValidUuidV4 } from '../shared/uuid.js';

/**
 * Follow-up（多轮追问）持久化层 helper。
 *
 * 来自设计文档 docs/superpowers/specs/2026-05-19-followup-rounds-design.md：
 * - findRunByPrefix：短前缀匹配 run_id
 * - validateParentEligible：仅 converged / escaped / single_agent_completed 可被追问
 * - loadChain：从 parent 上溯到 root，返回 [root, ..., parent]（最旧在前）
 *
 * PriorChainEntry 在此文件 canonical 定义；orchestrator / enhancer 全部 import 这一份。
 */

export class FollowupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FollowupError';
  }
}

/**
 * 追问链中的一段：runId + 该 run 的 enhanced 问题 + final.md。
 *
 * 在 persistence 层定义；orchestrator / enhancer 全部 import 这一 canonical 类型，避免命名分歧。
 */
export interface PriorChainEntry {
  runId: string;
  enhancedQuestion: string;
  finalMd: string;
}

/**
 * 短前缀匹配 run_id。
 *
 * - 36 字符 UUID 且目录存在：直接返回
 * - 前缀匹配：扫 runs/ 找以 prefix 起首的 UUID 目录
 *   - 0 个：抛 not found
 *   - 1 个：返回
 *   - 多个：抛 ambiguous
 */
export function findRunByPrefix(io: RunsIo, runsDir: string, prefix: string): string {
  if (isValidUuidV4(prefix) && io.runDirExists(prefix)) return prefix;
  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch {
    throw new FollowupError(`run ${prefix} not found（runs/ 不存在）`);
  }
  const matches = entries.filter((e) => isValidUuidV4(e) && e.startsWith(prefix));
  if (matches.length === 0) {
    throw new FollowupError(`run ${prefix} not found`);
  }
  if (matches.length > 1) {
    throw new FollowupError(
      `run id prefix ${prefix} matches multiple runs: ${matches.map((m) => m.slice(0, 8)).join(', ')}`,
    );
  }
  return matches[0]!;
}

/**
 * 校验 parent 是否可被追问。
 *
 * 仅 converged / escaped / single_agent_completed 通过；aborted / cancelled / 未完成均拒绝。
 */
export function validateParentEligible(meta: RunMeta): void {
  const ok =
    meta.outcome === 'converged' ||
    meta.outcome === 'escaped' ||
    meta.outcome === 'single_agent_completed';
  if (!ok) {
    throw new FollowupError(
      `run ${meta.run_id} 状态为 ${meta.outcome}，无法追问；请先 \`rtai resume ${meta.run_id}\` 或重跑`,
    );
  }
}

/**
 * 从 parent 沿 parent_run_id 链上溯到 root，返回 [root, ..., parent]（最旧在前）。
 *
 * 链中任意一段 final.md 缺失即抛 FollowupError。
 * 防御性：若链路出现循环（meta 损坏），最多 walk 50 步后抛错。
 */
export function loadChain(io: RunsIo, tailRunId: string): PriorChainEntry[] {
  const entries: PriorChainEntry[] = [];
  let current: string | null = tailRunId;
  let safetyHops = 0;
  while (current !== null) {
    if (++safetyHops > 50) {
      throw new FollowupError(`parent chain 深度异常（>50），疑似 meta 损坏`);
    }
    const meta: RunMeta | null = io.readMeta(current);
    if (meta === null) {
      throw new FollowupError(`run ${current} 不存在或 meta.json 损坏`);
    }
    const finalMd = io.readFinalMd(current);
    if (finalMd === null) {
      throw new FollowupError(`run ${current} 的 final.md 缺失，无法构造追问上下文`);
    }
    const enhanced = meta.enhanced_question ?? meta.raw_question;
    entries.push({ runId: meta.run_id, enhancedQuestion: enhanced, finalMd });
    current = meta.parent_run_id;
  }
  return entries.reverse();
}
