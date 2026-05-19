import { describe, expect, it } from 'vitest';
import {
  Round1Schema,
  Round2PlusSchema,
  SingleAgentSchema,
} from '../../src/shared/agent-output-schema.js';

describe('Round1Schema', () => {
  it('接受最小合法 Round 1 输出', () => {
    const result = Round1Schema.safeParse({
      answer: '推荐石头 G20S 与科沃斯 X2 两款。',
      key_claims: ['石头 G20S 在 3000 元档位首选'],
    });
    expect(result.success).toBe(true);
  });

  it('接受携带 uncertainty_notes 与 search_evidence 的输出', () => {
    const result = Round1Schema.safeParse({
      answer: 'a',
      key_claims: ['k1'],
      uncertainty_notes: ['某项指标待验证'],
      search_evidence: [{ url: 'https://example.com', snippet: 's', source: 'web' }],
    });
    expect(result.success).toBe(true);
  });

  it('passthrough：Round 2+ 字段（self_stability / peer_review）在 Round 1 中被接受但不参与校验', () => {
    const result = Round1Schema.safeParse({
      answer: 'a',
      key_claims: ['k1'],
      self_stability: 'stable',
      peer_review: [],
    });
    expect(result.success).toBe(true);
  });

  it('拒绝缺少 answer 的输出', () => {
    const result = Round1Schema.safeParse({ key_claims: ['k1'] });
    expect(result.success).toBe(false);
  });

  it('拒绝 answer 类型错误', () => {
    const result = Round1Schema.safeParse({ answer: 123, key_claims: [] });
    expect(result.success).toBe(false);
  });
});

describe('Round2PlusSchema', () => {
  const validBase = {
    answer: 'a',
    key_claims: ['k1'],
    self_stability: 'stable' as const,
    self_change_summary: '相对上轮无重大修订',
    peer_review: [
      {
        agent: 'codex',
        agree: true,
        agreement_basis: '已独立验证型号当前在售',
        disagreements: [],
      },
    ],
  };

  it('接受最小合法 Round 2+ 输出', () => {
    expect(Round2PlusSchema.safeParse(validBase).success).toBe(true);
  });

  it('接受 self_stability=refining', () => {
    const r = Round2PlusSchema.safeParse({ ...validBase, self_stability: 'refining' });
    expect(r.success).toBe(true);
  });

  it('拒绝 self_stability 非枚举值', () => {
    const r = Round2PlusSchema.safeParse({ ...validBase, self_stability: 'whatever' });
    expect(r.success).toBe(false);
  });

  it('拒绝缺少 peer_review', () => {
    const { peer_review: _peer_review, ...rest } = validBase;
    const r = Round2PlusSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('接受带 disagreement 的 peer_review，含 4 种 type', () => {
    for (const type of ['factual', 'reasoning', 'cosmetic', 'alternative_view'] as const) {
      const r = Round2PlusSchema.safeParse({
        ...validBase,
        peer_review: [
          {
            agent: 'codex',
            agree: false,
            agreement_basis: '',
            disagreements: [{ claim: 'c', my_view: 'v', type }],
          },
        ],
      });
      expect(r.success).toBe(true);
    }
  });

  it('拒绝 disagreement.type 非枚举值（如 stylistic）', () => {
    const r = Round2PlusSchema.safeParse({
      ...validBase,
      peer_review: [
        {
          agent: 'codex',
          agree: false,
          agreement_basis: '',
          disagreements: [{ claim: 'c', my_view: 'v', type: 'stylistic' }],
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe('SingleAgentSchema', () => {
  it('接受仅含 answer 的输出', () => {
    expect(SingleAgentSchema.safeParse({ answer: 'hello' }).success).toBe(true);
  });

  it('passthrough：其他字段被接受但忽略', () => {
    expect(
      SingleAgentSchema.safeParse({ answer: 'hello', key_claims: ['k1'], extra: 'noise' })
        .success,
    ).toBe(true);
  });

  it('拒绝缺少 answer', () => {
    expect(SingleAgentSchema.safeParse({}).success).toBe(false);
  });

  it('拒绝 answer 非 string', () => {
    expect(SingleAgentSchema.safeParse({ answer: 123 }).success).toBe(false);
  });
});
