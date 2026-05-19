/**
 * EventType 枚举：覆盖 §presenters / §roundtable-orchestrator 列出的 14 个事件类型。
 *
 * 事件所有权约定（来自 §finalizer / §roundtable-orchestrator）：
 * - 所有 finalized_* / finalized 事件由 Orchestrator 单独 emit
 * - Finalizer 是纯渲染函数，返回字符串而非自己 emit
 */
export const EventType = {
  // Enhancer 阶段
  EnhancementStarted: 'enhancement_started',
  EnhancementCompleted: 'enhancement_completed',

  // 用户交互
  UserInputRequested: 'user_input_requested',
  UserInputReceived: 'user_input_received',

  // 多 agent 圆桌轮
  RoundStarted: 'round_started',
  RoundCompleted: 'round_completed',
  AgentResponded: 'agent_responded',
  AgentErrored: 'agent_errored',
  ConvergenceChecked: 'convergence_checked',

  // 单 agent 路径
  SingleAgentStarted: 'single_agent_started',

  // 终结事件（仅 Orchestrator emit）
  FinalizedConverged: 'finalized_converged',
  FinalizedEscaped: 'finalized_escaped',
  FinalizedSingleAgent: 'finalized_single_agent',
  Finalized: 'finalized',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/**
 * 事件对象。
 *
 * 字段：
 * - type：事件类型（EventType 枚举值）
 * - timestamp：ISO 8601 字符串
 * - run_id：v4 UUID
 * - round：可选，多 agent 圆桌轮号（单 agent 路径无此字段）
 * - data：事件自带 payload，结构因 type 而异
 */
export interface Event {
  type: EventType;
  timestamp: string;
  run_id: string;
  round?: number;
  data: Record<string, unknown>;
}
