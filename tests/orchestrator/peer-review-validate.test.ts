import { describe, expect, it } from 'vitest';
import {
  buildPeerReviewRetrySuffix,
  validatePeerReview,
} from '../../src/orchestrator/peer-review-validate.js';
import type { Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

function makeOutput(peerReview: Round2PlusOutput['peer_review']): Round2PlusOutput {
  return {
    answer: 'a',
    key_claims: ['k'],
    uncertainty_notes: [],
    search_evidence: [],
    self_stability: 'stable',
    self_change_summary: '',
    peer_review: peerReview,
  };
}

describe('validatePeerReview — 覆盖性', () => {
  const active = ['claude', 'codex', 'gemini'];

  it('完整正确覆盖 → ok', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: true, agreement_basis: 'ok', disagreements: [] },
        { agent: 'gemini', agree: true, agreement_basis: 'ok', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(true);
  });

  it('漏一个 active agent → missing_agents', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: true, agreement_basis: 'ok', disagreements: [] },
        // 漏 gemini
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('missing_agents');
      expect(r.agents).toContain('gemini');
    }
  });

  it('多评审一个非 active agent → extra_agents', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: true, agreement_basis: 'ok', disagreements: [] },
        { agent: 'gemini', agree: true, agreement_basis: 'ok', disagreements: [] },
        { agent: 'unknown_agent', agree: true, agreement_basis: 'ok', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('extra_agents');
      expect(r.agents).toContain('unknown_agent');
    }
  });

  it('评审自己 → self_reviewed', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'claude', agree: true, agreement_basis: 'ok', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('self_reviewed');
    }
  });

  it('重复评审同一 agent → duplicate_agent', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: true, agreement_basis: 'ok', disagreements: [] },
        { agent: 'codex', agree: false, agreement_basis: '', disagreements: [
          { claim: 'c', my_view: 'v', type: 'factual' },
        ] },
        { agent: 'gemini', agree: true, agreement_basis: 'ok', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('duplicate_agent');
    }
  });
});

describe('validatePeerReview — agree-disagreements 一致性', () => {
  const active = ['claude', 'codex'];

  it('agree=true 但 agreement_basis 为空 → agree_true_empty_basis', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: true, agreement_basis: '', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('agree_true_empty_basis');
  });

  it('agree=false 但 disagreements=[] → agree_false_empty_disagreements', () => {
    const r = validatePeerReview({
      output: makeOutput([
        { agent: 'codex', agree: false, agreement_basis: '', disagreements: [] },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('agree_false_empty_disagreements');
  });

  it('agree=false + 非空 disagreements → ok', () => {
    const r = validatePeerReview({
      output: makeOutput([
        {
          agent: 'codex',
          agree: false,
          agreement_basis: '',
          disagreements: [{ claim: 'c', my_view: 'v', type: 'factual' }],
        },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(true);
  });

  it('agree=true + 非空 agreement_basis → ok（disagreements 可空）', () => {
    const r = validatePeerReview({
      output: makeOutput([
        {
          agent: 'codex',
          agree: true,
          agreement_basis: '已独立验证',
          disagreements: [],
        },
      ]),
      selfAgent: 'claude',
      activeAgents: active,
    });
    expect(r.ok).toBe(true);
  });
});

describe('buildPeerReviewRetrySuffix', () => {
  it('含错误描述 + 修正要求', () => {
    const s = buildPeerReviewRetrySuffix({
      ok: false,
      code: 'missing_agents',
      message: 'peer_review 缺失 gemini',
    });
    expect(s).toContain('---');
    expect(s).toContain('peer_review 缺失 gemini');
    expect(s).toContain('仅输出修正后的完整 JSON');
  });
});
