import { describe, expect, it } from 'vitest';
import {
  checkConverged,
  disagreementBlocks,
  type AgentRoundState,
} from '../../src/orchestrator/convergence.js';
import type { Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

function agentState(
  agent: string,
  stability: 'stable' | 'refining',
  disagreementType?: 'factual' | 'reasoning' | 'cosmetic' | 'alternative_view',
): AgentRoundState {
  const output: Round2PlusOutput = {
    answer: 'a',
    key_claims: ['k'],
    uncertainty_notes: [],
    search_evidence: [],
    self_stability: stability,
    self_change_summary: '',
    peer_review: disagreementType
      ? [
          {
            agent: 'other',
            agree: false,
            agreement_basis: '',
            disagreements: [{ claim: 'c', my_view: 'v', type: disagreementType }],
          },
        ]
      : [],
  };
  return { agent, errored: false, output };
}

describe('disagreementBlocks — strictness 三档', () => {
  it('strict：所有类型都阻塞', () => {
    expect(disagreementBlocks('factual', 'strict')).toBe(true);
    expect(disagreementBlocks('reasoning', 'strict')).toBe(true);
    expect(disagreementBlocks('cosmetic', 'strict')).toBe(true);
    expect(disagreementBlocks('alternative_view', 'strict')).toBe(true);
  });

  it('medium：factual / reasoning 阻塞；cosmetic / alternative_view 不阻塞', () => {
    expect(disagreementBlocks('factual', 'medium')).toBe(true);
    expect(disagreementBlocks('reasoning', 'medium')).toBe(true);
    expect(disagreementBlocks('cosmetic', 'medium')).toBe(false);
    expect(disagreementBlocks('alternative_view', 'medium')).toBe(false);
  });

  it('loose：仅 factual 阻塞', () => {
    expect(disagreementBlocks('factual', 'loose')).toBe(true);
    expect(disagreementBlocks('reasoning', 'loose')).toBe(false);
    expect(disagreementBlocks('cosmetic', 'loose')).toBe(false);
    expect(disagreementBlocks('alternative_view', 'loose')).toBe(false);
  });
});

describe('checkConverged — min_rounds 边界', () => {
  it('current_round < min_rounds → below_min_rounds', () => {
    const r = checkConverged({
      currentRound: 1,
      scene: { min_rounds: 3, convergence_strictness: 'medium' },
      agents: [agentState('a', 'stable')],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('below_min_rounds');
  });

  it('Round 1 强制不允许收敛（即使 min_rounds=1）', () => {
    const r = checkConverged({
      currentRound: 1,
      scene: { min_rounds: 1, convergence_strictness: 'loose' },
      agents: [agentState('a', 'stable')],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('round1_forced_non_convergence');
  });
});

describe('checkConverged — ERRORED 阻塞', () => {
  it('任一 agent errored=true → has_errored_agent', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'medium' },
      agents: [
        agentState('a', 'stable'),
        { agent: 'b', errored: true },
      ],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('has_errored_agent');
    expect(r.agentsInvolved).toContain('b');
  });
});

describe('checkConverged — self_stability', () => {
  it('任一 agent refining → some_agent_refining', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'medium' },
      agents: [agentState('a', 'stable'), agentState('b', 'refining')],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('some_agent_refining');
    expect(r.agentsInvolved).toContain('b');
  });
});

describe('checkConverged — 收敛成功', () => {
  it('全部 stable + 无 disagreement → 收敛', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'strict' },
      agents: [agentState('a', 'stable'), agentState('b', 'stable')],
    });
    expect(r.converged).toBe(true);
  });

  it('medium + 仅 cosmetic disagreement → 收敛', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'medium' },
      agents: [agentState('a', 'stable', 'cosmetic'), agentState('b', 'stable')],
    });
    expect(r.converged).toBe(true);
  });

  it('loose + reasoning disagreement → 收敛', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'loose' },
      agents: [agentState('a', 'stable', 'reasoning')],
    });
    expect(r.converged).toBe(true);
  });
});

describe('checkConverged — blocking disagreement', () => {
  it('strict + cosmetic → blocking', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'strict' },
      agents: [agentState('a', 'stable', 'cosmetic')],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('has_blocking_disagreement');
  });

  it('medium + factual → blocking', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'medium' },
      agents: [agentState('a', 'stable', 'factual')],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('has_blocking_disagreement');
  });

  it('loose + factual → blocking', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'loose' },
      agents: [agentState('a', 'stable', 'factual')],
    });
    expect(r.converged).toBe(false);
  });
});

describe('checkConverged — 边界', () => {
  it('agents 空 → no_active_agents', () => {
    const r = checkConverged({
      currentRound: 2,
      scene: { min_rounds: 2, convergence_strictness: 'medium' },
      agents: [],
    });
    expect(r.converged).toBe(false);
    expect(r.reason).toBe('no_active_agents');
  });
});
