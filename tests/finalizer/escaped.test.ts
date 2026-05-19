import { describe, expect, it } from 'vitest';
import { renderEscaped } from '../../src/finalizer/escaped.js';
import type { Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

function sampleOutput(answer: string, claims: string[], peerReview: Round2PlusOutput['peer_review']): Round2PlusOutput {
  return {
    answer,
    key_claims: claims,
    uncertainty_notes: [],
    search_evidence: [],
    self_stability: 'refining',
    self_change_summary: '',
    peer_review: peerReview,
  };
}

describe('renderEscaped — 三段结构', () => {
  it('含共识 + 分歧矩阵 + 各家答案 + 你的下一步', () => {
    const md = renderEscaped({
      enhancedQuestion: '推荐扫地机器人',
      agentOutputs: new Map([
        [
          'claude',
          sampleOutput(
            'claude 的完整答案',
            ['G20S 推荐', '需要大电池'],
            [
              {
                agent: 'codex',
                agree: false,
                agreement_basis: '',
                disagreements: [
                  { claim: '首选型号', my_view: '我选 G20S', type: 'factual' },
                ],
              },
            ],
          ),
        ],
        [
          'codex',
          sampleOutput(
            'codex 的完整答案',
            ['G20S 推荐'],
            [
              {
                agent: 'claude',
                agree: false,
                agreement_basis: '',
                disagreements: [
                  { claim: '首选型号', my_view: '我选 X2', type: 'factual' },
                ],
              },
            ],
          ),
        ],
      ]),
      scene: 'consumer',
      roundsCompleted: 5,
      participants: ['claude', 'codex'],
      runId: 'abc',
      resolvedUiLanguage: 'zh-Hans',
    });

    expect(md).toContain('## 共识部分');
    expect(md).toContain('G20S 推荐'); // 共识 claim
    expect(md).toContain('## 分歧矩阵');
    expect(md).toContain('首选型号');
    expect(md).toContain('## 各家完整答案');
    expect(md).toContain('<details>');
    expect(md).toContain('claude');
    expect(md).toContain('codex');
    expect(md).toContain('## 你的下一步');
  });

  it('无共识 claim 时显示提示文案', () => {
    const md = renderEscaped({
      enhancedQuestion: 'q',
      agentOutputs: new Map([
        ['a', sampleOutput('a', ['unique to a'], [])],
        ['b', sampleOutput('b', ['unique to b'], [])],
      ]),
      scene: 'consumer',
      roundsCompleted: 5,
      participants: ['a', 'b'],
      runId: 'r',
      resolvedUiLanguage: 'zh-Hans',
    });
    expect(md).toContain('无字面相同');
  });

  it('英文 ui language → 英文段标题', () => {
    const md = renderEscaped({
      enhancedQuestion: 'q',
      agentOutputs: new Map([
        ['a', sampleOutput('a', [], [])],
        ['b', sampleOutput('b', [], [])],
      ]),
      scene: 'consumer',
      roundsCompleted: 5,
      participants: ['a', 'b'],
      runId: 'r',
      resolvedUiLanguage: 'en',
    });
    expect(md).toContain('## Consensus');
    expect(md).toContain('## Disagreements Matrix');
    expect(md).toContain('## Full Answers');
    expect(md).toContain('## Your Next Step');
  });
});
