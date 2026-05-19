/**
 * Orchestrator 状态机骨架（仅状态枚举与合法 transition 定义；不含业务执行）。
 *
 * 来自 §roundtable-orchestrator "状态机驱动（两层分支）" + tasks.md §8.1 / §8.2 / §8.4。
 *
 * 状态划分：
 * - 多 agent 路径：IDLE → ENHANCING → AWAITING_USER_CONFIRM → BRANCHING_AFTER_CONFIRM →
 *   ROUND_RUNNING ⇄ CHECKING_CONVERGENCE → FINALIZING_{CONVERGED,ESCAPED} → DONE
 * - 单 agent direct 路径：IDLE → SINGLE_AGENT_DIRECT_INVOKING → FINALIZING_SINGLE → DONE
 * - 单 agent downgraded 路径：BRANCHING_AFTER_CONFIRM → SINGLE_AGENT_DOWNGRADED_INVOKING →
 *   FINALIZING_SINGLE → DONE
 * - abort / cancel 出口：ABORT_EMPTY / ABORT_NO_PARTICIPANTS / CANCELLED → DONE
 *
 * 中间状态 RECOMPUTE_WITH_GENERAL_SCENE 是 Layer 2 fallback 的一次尝试（仅一次，
 * 防无限循环；二次失败直接 ABORT_NO_PARTICIPANTS）。
 */

export const State = {
  Idle: 'IDLE',
  Enhancing: 'ENHANCING',
  AwaitingUserConfirm: 'AWAITING_USER_CONFIRM',
  BranchingAfterConfirm: 'BRANCHING_AFTER_CONFIRM',
  RecomputeWithGeneralScene: 'RECOMPUTE_WITH_GENERAL_SCENE',
  RoundRunning: 'ROUND_RUNNING',
  CheckingConvergence: 'CHECKING_CONVERGENCE',
  SingleAgentDirectInvoking: 'SINGLE_AGENT_DIRECT_INVOKING',
  SingleAgentDowngradedInvoking: 'SINGLE_AGENT_DOWNGRADED_INVOKING',
  FinalizingConverged: 'FINALIZING_CONVERGED',
  FinalizingEscaped: 'FINALIZING_ESCAPED',
  FinalizingSingle: 'FINALIZING_SINGLE',
  Cancelled: 'CANCELLED',
  AbortEmpty: 'ABORT_EMPTY',
  AbortNoParticipants: 'ABORT_NO_PARTICIPANTS',
  Done: 'DONE',
} as const;

export type State = (typeof State)[keyof typeof State];

/**
 * 合法 transition 表（src → 允许目的 set）。用于 transition 函数防御性检查；非法
 * transition 直接 throw（暴露 bug）。
 */
const TRANSITIONS: Readonly<Record<State, readonly State[]>> = {
  IDLE: [
    State.Enhancing,
    State.SingleAgentDirectInvoking,
    State.AbortEmpty,
  ],
  ENHANCING: [
    State.AwaitingUserConfirm,
    State.AbortEmpty, // 极端情形（Enhancer 阶段崩溃）
  ],
  AWAITING_USER_CONFIRM: [State.BranchingAfterConfirm, State.Cancelled],
  BRANCHING_AFTER_CONFIRM: [
    State.RoundRunning,
    State.SingleAgentDowngradedInvoking,
    State.RecomputeWithGeneralScene,
    State.AbortNoParticipants,
  ],
  RECOMPUTE_WITH_GENERAL_SCENE: [
    State.RoundRunning,
    State.SingleAgentDowngradedInvoking,
    State.AbortNoParticipants,
  ],
  ROUND_RUNNING: [State.CheckingConvergence, State.AbortNoParticipants],
  CHECKING_CONVERGENCE: [
    State.RoundRunning, // 未收敛 round++ 继续
    State.FinalizingConverged,
    State.FinalizingEscaped,
  ],
  SINGLE_AGENT_DIRECT_INVOKING: [State.FinalizingSingle, State.AbortNoParticipants],
  SINGLE_AGENT_DOWNGRADED_INVOKING: [State.FinalizingSingle, State.AbortNoParticipants],
  FINALIZING_CONVERGED: [State.Done],
  FINALIZING_ESCAPED: [State.Done],
  FINALIZING_SINGLE: [State.Done],
  CANCELLED: [State.Done],
  ABORT_EMPTY: [State.Done],
  ABORT_NO_PARTICIPANTS: [State.Done],
  DONE: [],
};

export class InvalidTransitionError extends Error {
  constructor(public readonly from: State, public readonly to: State) {
    super(`非法 state transition：${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** 校验 transition 是否合法。 */
export function isLegalTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to);
}

/** 一个最小的状态机 holder，供 Orchestrator 使用。 */
export class StateMachine {
  private _state: State = State.Idle;

  get state(): State {
    return this._state;
  }

  /** 切换状态；非法 transition 抛错（暴露 bug）。 */
  transition(to: State): void {
    if (!isLegalTransition(this._state, to)) {
      throw new InvalidTransitionError(this._state, to);
    }
    this._state = to;
  }

  /** 强制设状态（仅测试用；正常使用 transition）。 */
  _forceSetState(state: State): void {
    this._state = state;
  }
}
