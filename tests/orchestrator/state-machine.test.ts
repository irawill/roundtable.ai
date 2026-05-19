import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  State,
  StateMachine,
  isLegalTransition,
} from '../../src/orchestrator/state-machine.js';

describe('isLegalTransition — 多 agent 收敛路径', () => {
  it('IDLE → ENHANCING → AWAITING_USER_CONFIRM → BRANCHING_AFTER_CONFIRM', () => {
    expect(isLegalTransition(State.Idle, State.Enhancing)).toBe(true);
    expect(isLegalTransition(State.Enhancing, State.AwaitingUserConfirm)).toBe(true);
    expect(isLegalTransition(State.AwaitingUserConfirm, State.BranchingAfterConfirm)).toBe(true);
  });

  it('BRANCHING → ROUND_RUNNING → CHECKING_CONVERGENCE → FINALIZING_CONVERGED → DONE', () => {
    expect(isLegalTransition(State.BranchingAfterConfirm, State.RoundRunning)).toBe(true);
    expect(isLegalTransition(State.RoundRunning, State.CheckingConvergence)).toBe(true);
    expect(isLegalTransition(State.CheckingConvergence, State.FinalizingConverged)).toBe(true);
    expect(isLegalTransition(State.FinalizingConverged, State.Done)).toBe(true);
  });

  it('CHECKING → ROUND_RUNNING（未收敛继续）', () => {
    expect(isLegalTransition(State.CheckingConvergence, State.RoundRunning)).toBe(true);
  });

  it('CHECKING → FINALIZING_ESCAPED', () => {
    expect(isLegalTransition(State.CheckingConvergence, State.FinalizingEscaped)).toBe(true);
  });
});

describe('isLegalTransition — 单 agent direct 路径', () => {
  it('IDLE → SINGLE_AGENT_DIRECT_INVOKING → FINALIZING_SINGLE → DONE', () => {
    expect(isLegalTransition(State.Idle, State.SingleAgentDirectInvoking)).toBe(true);
    expect(isLegalTransition(State.SingleAgentDirectInvoking, State.FinalizingSingle)).toBe(true);
    expect(isLegalTransition(State.FinalizingSingle, State.Done)).toBe(true);
  });
});

describe('isLegalTransition — 单 agent downgraded 路径', () => {
  it('BRANCHING → SINGLE_AGENT_DOWNGRADED_INVOKING → FINALIZING_SINGLE → DONE', () => {
    expect(isLegalTransition(State.BranchingAfterConfirm, State.SingleAgentDowngradedInvoking)).toBe(true);
    expect(isLegalTransition(State.SingleAgentDowngradedInvoking, State.FinalizingSingle)).toBe(true);
  });
});

describe('isLegalTransition — RECOMPUTE_WITH_GENERAL_SCENE', () => {
  it('BRANCHING → RECOMPUTE_WITH_GENERAL_SCENE → ROUND_RUNNING / DOWNGRADED / ABORT', () => {
    expect(isLegalTransition(State.BranchingAfterConfirm, State.RecomputeWithGeneralScene)).toBe(true);
    expect(isLegalTransition(State.RecomputeWithGeneralScene, State.RoundRunning)).toBe(true);
    expect(isLegalTransition(State.RecomputeWithGeneralScene, State.SingleAgentDowngradedInvoking)).toBe(true);
    expect(isLegalTransition(State.RecomputeWithGeneralScene, State.AbortNoParticipants)).toBe(true);
  });
});

describe('isLegalTransition — cancellation / abort', () => {
  it('IDLE → ABORT_EMPTY → DONE', () => {
    expect(isLegalTransition(State.Idle, State.AbortEmpty)).toBe(true);
    expect(isLegalTransition(State.AbortEmpty, State.Done)).toBe(true);
  });

  it('AWAITING_USER_CONFIRM → CANCELLED → DONE', () => {
    expect(isLegalTransition(State.AwaitingUserConfirm, State.Cancelled)).toBe(true);
    expect(isLegalTransition(State.Cancelled, State.Done)).toBe(true);
  });
});

describe('isLegalTransition — 非法 transition', () => {
  it('IDLE → ROUND_RUNNING（跳过中间）非法', () => {
    expect(isLegalTransition(State.Idle, State.RoundRunning)).toBe(false);
  });

  it('IDLE → FINALIZING_CONVERGED 非法', () => {
    expect(isLegalTransition(State.Idle, State.FinalizingConverged)).toBe(false);
  });

  it('DONE → 任何 非法', () => {
    for (const target of Object.values(State)) {
      if (target === 'DONE') continue;
      expect(isLegalTransition(State.Done, target as State)).toBe(false);
    }
  });
});

describe('StateMachine', () => {
  it('初始状态 IDLE', () => {
    expect(new StateMachine().state).toBe(State.Idle);
  });

  it('合法 transition 推进状态', () => {
    const sm = new StateMachine();
    sm.transition(State.Enhancing);
    expect(sm.state).toBe(State.Enhancing);
    sm.transition(State.AwaitingUserConfirm);
    expect(sm.state).toBe(State.AwaitingUserConfirm);
  });

  it('非法 transition throw InvalidTransitionError', () => {
    const sm = new StateMachine();
    expect(() => sm.transition(State.RoundRunning)).toThrow(InvalidTransitionError);
  });
});
