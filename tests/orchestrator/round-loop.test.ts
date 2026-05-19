import { describe, expect, it, vi } from 'vitest';
import {
  BlacklistTracker,
  runRound,
  type AgentRoundOutput,
} from '../../src/orchestrator/round-loop.js';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import type { Adapter, AdapterInvokeArgs, AdapterResult } from '../../src/shared/adapter.js';
import type { Round1Output, Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

function mockAdapter(
  name: string,
  behavior: 'ok-round1' | 'ok-round2' | 'timeout' | 'parse_fail' | 'peer_review_fail',
  customOutput?: Round1Output | Round2PlusOutput,
): Adapter {
  return {
    name,
    capabilities: [],
    roleSuitability: { enhancer: 'high', executor: 'high' },
    binaryAvailable: vi.fn(async () => true),
    version: vi.fn(async () => '1.0.0'),
    detectAuthState: vi.fn(async () => 'ok'),
    authInstructions: vi.fn(() => 'login'),
    invoke: vi.fn(async (_args: AdapterInvokeArgs): Promise<AdapterResult> => {
      if (behavior === 'timeout') {
        throw new Error('invoke 超时');
      }
      if (behavior === 'parse_fail') {
        throw new Error('schema 校验失败');
      }
      if (behavior === 'ok-round1') {
        const r: Round1Output = customOutput as Round1Output ?? {
          answer: 'r1 answer',
          key_claims: ['k1'],
          uncertainty_notes: [],
          search_evidence: [],
        };
        return { rawStdout: '', parsed: r, usage: null, durationMs: 100 };
      }
      // ok-round2 / peer_review_fail
      const r: Round2PlusOutput = (customOutput as Round2PlusOutput) ?? {
        answer: 'r2 answer',
        key_claims: ['k'],
        uncertainty_notes: [],
        search_evidence: [],
        self_stability: 'stable',
        self_change_summary: '',
        peer_review: [],
      };
      return { rawStdout: '', parsed: r, usage: null, durationMs: 120 };
    }),
  };
}

describe('runRound — Round 1', () => {
  const scene = BUILTIN_SCENES.scenes.general!;

  it('3 个 agent 全部 ok → 返回 3 个 ok 结果', async () => {
    const adapters = new Map([
      ['a', mockAdapter('a', 'ok-round1')],
      ['b', mockAdapter('b', 'ok-round1')],
      ['c', mockAdapter('c', 'ok-round1')],
    ]);
    const effortMap = new Map<string, 'medium'>([
      ['a', 'medium'],
      ['b', 'medium'],
      ['c', 'medium'],
    ]);
    const r = await runRound({
      round: 1,
      activeAgents: ['a', 'b', 'c'],
      adapters,
      effortMap,
      scene,
      enhancedQuestion: 'q',
      resolvedOutputLanguage: 'en',
      previousOutputs: new Map(),
      timeoutMs: 5000,
    });
    expect(r.results).toHaveLength(3);
    expect(r.results.every((x) => x.ok)).toBe(true);
  });

  it('1 个 agent timeout，其他 ok → ERRORED 不阻塞', async () => {
    const adapters = new Map([
      ['a', mockAdapter('a', 'ok-round1')],
      ['b', mockAdapter('b', 'timeout')],
      ['c', mockAdapter('c', 'ok-round1')],
    ]);
    const effortMap = new Map<string, 'medium'>([
      ['a', 'medium'],
      ['b', 'medium'],
      ['c', 'medium'],
    ]);
    const r = await runRound({
      round: 1,
      activeAgents: ['a', 'b', 'c'],
      adapters,
      effortMap,
      scene,
      enhancedQuestion: 'q',
      resolvedOutputLanguage: 'en',
      previousOutputs: new Map(),
      timeoutMs: 5000,
    });
    const erroredAgent = r.results.find((x) => x.agent === 'b');
    expect(erroredAgent?.ok).toBe(false);
    const okAgents = r.results.filter((x) => x.ok);
    expect(okAgents).toHaveLength(2);
  });
});

describe('runRound — Round 2+ peer_review 校验', () => {
  const scene = BUILTIN_SCENES.scenes.general!;

  it('peer_review 完整 → ok', async () => {
    const okOutput: Round2PlusOutput = {
      answer: 'a',
      key_claims: ['k'],
      uncertainty_notes: [],
      search_evidence: [],
      self_stability: 'stable',
      self_change_summary: '',
      peer_review: [
        { agent: 'b', agree: true, agreement_basis: 'ok', disagreements: [] },
        { agent: 'c', agree: true, agreement_basis: 'ok', disagreements: [] },
      ],
    };
    const adapters = new Map([
      ['a', mockAdapter('a', 'ok-round2', okOutput)],
      ['b', mockAdapter('b', 'ok-round2', okOutput)],
      ['c', mockAdapter('c', 'ok-round2', okOutput)],
    ]);
    const effortMap = new Map<string, 'medium'>([
      ['a', 'medium'],
      ['b', 'medium'],
      ['c', 'medium'],
    ]);
    // mock 简化：所有 agent 用同一 peer_review 配置（评审 b/c 而 a 自己是 b/c 时会出问题）；
    // 仅看 a 的结果
    const r = await runRound({
      round: 2,
      activeAgents: ['a', 'b', 'c'],
      adapters,
      effortMap,
      scene,
      enhancedQuestion: 'q',
      resolvedOutputLanguage: 'en',
      previousOutputs: new Map([
        ['b', { answer: 'b1', key_claims: [], uncertainty_notes: [], search_evidence: [] }],
        ['c', { answer: 'c1', key_claims: [], uncertainty_notes: [], search_evidence: [] }],
      ]),
      timeoutMs: 5000,
    });
    const aResult = r.results.find((x) => x.agent === 'a');
    expect(aResult?.ok).toBe(true);
  });

  it('peer_review 缺一个 active agent → 重试 → 仍失败 → ERRORED', async () => {
    const incomplete: Round2PlusOutput = {
      answer: 'a',
      key_claims: [],
      uncertainty_notes: [],
      search_evidence: [],
      self_stability: 'stable',
      self_change_summary: '',
      peer_review: [
        { agent: 'b', agree: true, agreement_basis: 'ok', disagreements: [] },
        // 漏 c
      ],
    };
    const adapters = new Map([
      ['a', mockAdapter('a', 'ok-round2', incomplete)],
      ['b', mockAdapter('b', 'ok-round2', incomplete)],
      ['c', mockAdapter('c', 'ok-round2', incomplete)],
    ]);
    const r = await runRound({
      round: 2,
      activeAgents: ['a', 'b', 'c'],
      adapters,
      effortMap: new Map([
        ['a', 'medium'],
        ['b', 'medium'],
        ['c', 'medium'],
      ]),
      scene: BUILTIN_SCENES.scenes.general!,
      enhancedQuestion: 'q',
      resolvedOutputLanguage: 'en',
      previousOutputs: new Map(),
      timeoutMs: 5000,
    });
    const aResult = r.results.find((x) => x.agent === 'a');
    expect(aResult?.ok).toBe(false);
    if (aResult && !aResult.ok) {
      expect(aResult.error).toContain('peer_review');
    }
  });
});

describe('BlacklistTracker — 连续 2 轮 ERRORED 拉黑', () => {
  it('单 agent 1 轮 ERRORED 未拉黑', () => {
    const t = new BlacklistTracker();
    t.update([{ agent: 'a', ok: false, round: 1, error: 'x', durationMs: 0 }]);
    expect(t.isBlacklisted('a')).toBe(false);
    expect(t.getCount('a')).toBe(1);
  });

  it('单 agent 连续 2 轮 ERRORED → 拉黑', () => {
    const t = new BlacklistTracker();
    t.update([{ agent: 'a', ok: false, round: 1, error: 'x', durationMs: 0 }]);
    t.update([{ agent: 'a', ok: false, round: 2, error: 'y', durationMs: 0 }]);
    expect(t.isBlacklisted('a')).toBe(true);
    expect(t.getBlacklisted()).toEqual(['a']);
  });

  it('成功一轮重置 counter', () => {
    const t = new BlacklistTracker();
    t.update([{ agent: 'a', ok: false, round: 1, error: 'x', durationMs: 0 }]);
    t.update([
      {
        agent: 'a',
        ok: true,
        round: 2,
        output: {
          answer: 'a',
          key_claims: [],
          uncertainty_notes: [],
          search_evidence: [],
          self_stability: 'stable',
          self_change_summary: '',
          peer_review: [],
        },
        durationMs: 10,
      },
    ]);
    expect(t.getCount('a')).toBe(0);
    expect(t.isBlacklisted('a')).toBe(false);
  });

  it('filterActive 移除被拉黑的', () => {
    const t = new BlacklistTracker();
    t.update([
      { agent: 'a', ok: false, round: 1, error: 'x', durationMs: 0 },
      { agent: 'b', ok: false, round: 1, error: 'x', durationMs: 0 },
    ]);
    t.update([
      { agent: 'a', ok: false, round: 2, error: 'x', durationMs: 0 },
      { agent: 'b', ok: false, round: 2, error: 'x', durationMs: 0 },
    ]);
    expect(t.filterActive(['a', 'b', 'c'])).toEqual(['c']);
  });
});
