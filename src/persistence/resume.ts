import { EventType, type Event } from '../shared/event-types.js';
import type { Round2PlusOutput } from '../shared/agent-output-schema.js';
import type { RunMeta } from './meta.js';
import type { RunsIo } from './runs.js';

/**
 * rtai resume <uuid>：从 events.jsonl 重建状态，继续未完成的 run。
 *
 * 来自 §persistence-history "rtai resume 恢复" + tasks.md §17.7。
 *
 * 行为：
 * - 已 converged / escaped / single_agent_completed → 拒绝 resume（提示 run 已完成）
 * - 已 aborted → 拒绝 resume
 * - 中途 Ctrl-C（events.jsonl 已落盘）→ 从下一轮继续（已完成 round 不重跑）
 * - 复用 meta.json.language（**不**重新检测语言）
 * - 复用 enhanced_question（**不**重跑 Enhancer）
 * - --no-persist run 找不到 uuid（rtai history 不显示）→ 自动报错
 */

export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeError';
  }
}

export interface ResumeStateArgs {
  runsIo: RunsIo;
  runId: string;
}

export interface ResumeState {
  meta: RunMeta;
  /** 已落盘的事件序列（按时序） */
  events: Event[];
  /** 重建出来的"上一轮完成的 round 号"；从 nextRound 开始继续 */
  lastCompletedRound: number;
  /** nextRound 起点（lastCompletedRound + 1） */
  nextRound: number;
  /** 已收集到的每 agent 每 round 输出（用于 Round 2+ prompt 拼装） */
  previousOutputs: Map<string, Round2PlusOutput>;
}

/**
 * 主入口：读取 meta + events → 决定能否 resume + 返回重建状态。
 *
 * @throws ResumeError 已完成 / 找不到 / 损坏
 */
export function buildResumeState(args: ResumeStateArgs): ResumeState {
  const meta = args.runsIo.readMeta(args.runId);
  if (meta === null) {
    throw new ResumeError(
      `找不到 runs/${args.runId}/（如果是 --no-persist run，无法 resume）`,
    );
  }
  const m = meta as unknown as RunMeta;

  // 已完成 → 拒绝
  if (m.outcome === 'converged' || m.outcome === 'escaped') {
    throw new ResumeError(`run ${args.runId} 已 ${m.outcome}，无法 resume；运行 \`rtai show ${args.runId}\` 查看`);
  }
  if (m.outcome === 'single_agent_completed') {
    throw new ResumeError(`run ${args.runId} 已 single_agent_completed，无法 resume`);
  }
  // aborted 路径：spec 未明确，保守拒绝（用户应当重跑而非 resume）
  if (m.outcome === 'aborted') {
    throw new ResumeError(`run ${args.runId} 已 aborted，请重跑而非 resume`);
  }

  const events = args.runsIo.readEvents(args.runId);
  if (events.length === 0) {
    throw new ResumeError(`runs/${args.runId}/events.jsonl 为空或不存在，无法 resume`);
  }

  return rebuildFromEvents(m, events);
}

/**
 * 从 events 序列重建状态：
 * - 找最后一个 round_completed 事件 → lastCompletedRound
 * - 收集所有 agent_responded（按 agent 取最后一个 round 的 output）
 */
function rebuildFromEvents(meta: RunMeta, events: readonly Event[]): ResumeState {
  let lastCompletedRound = 0;
  const previousOutputs = new Map<string, Round2PlusOutput>();
  const latestRoundPerAgent = new Map<string, number>();

  for (const evt of events) {
    if (evt.type === EventType.RoundCompleted && typeof evt.round === 'number') {
      if (evt.round > lastCompletedRound) lastCompletedRound = evt.round;
    }
    if (evt.type === EventType.AgentResponded && typeof evt.round === 'number') {
      const data = evt.data as Record<string, unknown>;
      const agent = data.agent as string | undefined;
      const output = data.output as Round2PlusOutput | undefined;
      if (agent !== undefined && output !== undefined) {
        const currentRound = latestRoundPerAgent.get(agent) ?? -1;
        if (evt.round > currentRound) {
          latestRoundPerAgent.set(agent, evt.round);
          previousOutputs.set(agent, output);
        }
      }
    }
  }

  return {
    meta,
    events: [...events],
    lastCompletedRound,
    nextRound: lastCompletedRound + 1,
    previousOutputs,
  };
}
