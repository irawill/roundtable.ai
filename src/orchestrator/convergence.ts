import type { DisagreementType, Round2PlusOutput } from '../shared/agent-output-schema.js';

/**
 * 确定性收敛判定。
 *
 * 来自 §roundtable-orchestrator "确定性收敛判定" + §scene-system "convergence_strictness 三档"
 * + tasks.md §10.1-§10.6 + 跨阶段约束 #4 设计决策。
 *
 * 核心约定：**不调用任何 LLM**。仅读结构化字段：
 * - 所有 agent 的 self_stability
 * - 每个 agent 的 peer_review[].disagreements[]
 * - scene 的 min_rounds / convergence_strictness
 *
 * 返回 true 当且仅当**全部**满足：
 *   1. current_round &gt;= scene.min_rounds
 *   2. 当前轮不存在 ERRORED active agent
 *   3. 所有 active agent self_stability == 'stable'
 *   4. 所有 active agent 的所有 disagreement 在 strictness 下**不**阻塞
 *
 * 特殊规则：
 * - Round 1 强制忽略 self_stability=stable（防过早收敛；spec "Round 1 不允许 stable"）
 * - peer_review 覆盖性失败的 agent 已被标 ERRORED（外部）；本函数读到 ERRORED 即返回 false
 */

/** strictness 三档（来自 §scene-system "convergence_strictness 三档"）。 */
export type ConvergenceStrictness = 'strict' | 'medium' | 'loose';

/**
 * disagreementBlocks：判断单个 disagreement 在给定 strictness 下是否阻塞收敛。
 *
 * 规则（来自 §scene-system "convergence_strictness 三档"）：
 * - strict：任何 disagreement 都阻塞
 * - medium：factual / reasoning 类型阻塞
 * - loose：仅 factual 阻塞
 *
 * cosmetic / alternative_view 在 medium 下不阻塞；在 strict 下阻塞。
 */
export function disagreementBlocks(
  type: DisagreementType,
  strictness: ConvergenceStrictness,
): boolean {
  switch (strictness) {
    case 'strict':
      return true; // 任何类型都阻塞
    case 'medium':
      return type === 'factual' || type === 'reasoning';
    case 'loose':
      return type === 'factual';
  }
}

/** 单个 active agent 的本轮状态（汇集到本函数判定）。 */
export interface AgentRoundState {
  /** agent 名 */
  agent: string;
  /** 本轮是否 ERRORED（adapter 报错 / JSON parse 失败 / peer_review 校验失败重试后仍 ERRORED） */
  errored: boolean;
  /** 仅 errored=false 时有意义：agent 的 round 2+ 输出 */
  output?: Round2PlusOutput;
}

export interface CheckConvergedArgs {
  /** 当前轮号（从 1 起） */
  currentRound: number;
  /** scene 配置（仅取 min_rounds + convergence_strictness） */
  scene: {
    min_rounds: number;
    convergence_strictness: ConvergenceStrictness;
  };
  /** 本轮所有 active agent 的状态（含 ERRORED 与正常） */
  agents: readonly AgentRoundState[];
}

export interface CheckConvergedResult {
  /** 是否收敛 */
  converged: boolean;
  /** 不收敛的原因（用于 events.jsonl convergence_checked 事件 / debug） */
  reason?:
    | 'below_min_rounds'
    | 'has_errored_agent'
    | 'some_agent_refining'
    | 'has_blocking_disagreement'
    | 'no_active_agents'
    | 'round1_forced_non_convergence';
  /** 不收敛时填充：相关 agent 列表 */
  agentsInvolved?: string[];
}

/**
 * 主入口：判定是否收敛。
 *
 * 来自 §roundtable-orchestrator "确定性收敛判定" 4 个 AND 条件。
 */
export function checkConverged(args: CheckConvergedArgs): CheckConvergedResult {
  // 边界 0：无 active agent → 不收敛（调用方应已 abort，但防御性处理）
  if (args.agents.length === 0) {
    return { converged: false, reason: 'no_active_agents' };
  }

  // 条件 1：min_rounds 边界
  if (args.currentRound < args.scene.min_rounds) {
    return { converged: false, reason: 'below_min_rounds' };
  }

  // Round 1 强制忽略 self_stability=stable（防过早收敛；spec "Round 1 不允许 stable"）
  // 即使 Round 1 满足其他条件也返回 false——配合 min_rounds>=2 时此分支理论不触发，但保留
  if (args.currentRound === 1) {
    return { converged: false, reason: 'round1_forced_non_convergence' };
  }

  // 条件 2：本轮无 ERRORED active agent（peer_review 校验失败重试仍失败的 agent 已 errored=true）
  const errored = args.agents.filter((a) => a.errored).map((a) => a.agent);
  if (errored.length > 0) {
    return {
      converged: false,
      reason: 'has_errored_agent',
      agentsInvolved: errored,
    };
  }

  // 条件 3：所有 active agent self_stability == 'stable'
  const refining = args.agents
    .filter((a) => a.output?.self_stability === 'refining')
    .map((a) => a.agent);
  if (refining.length > 0) {
    return {
      converged: false,
      reason: 'some_agent_refining',
      agentsInvolved: refining,
    };
  }

  // 条件 4：所有 disagreement 在 strictness 下不阻塞
  const blockingAgents: string[] = [];
  for (const agent of args.agents) {
    if (!agent.output) continue;
    for (const review of agent.output.peer_review) {
      for (const dis of review.disagreements) {
        if (disagreementBlocks(dis.type, args.scene.convergence_strictness)) {
          if (!blockingAgents.includes(agent.agent)) blockingAgents.push(agent.agent);
        }
      }
    }
  }
  if (blockingAgents.length > 0) {
    return {
      converged: false,
      reason: 'has_blocking_disagreement',
      agentsInvolved: blockingAgents,
    };
  }

  return { converged: true };
}
