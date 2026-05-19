import { describe, expect, it } from 'vitest';
import {
  buildDisagreementMatrix,
  renderMatrixMarkdown,
} from '../../src/finalizer/disagreement-matrix.js';
import type { Round2PlusOutput } from '../../src/shared/agent-output-schema.js';

function output(
  peerReview: Round2PlusOutput['peer_review'],
): Round2PlusOutput {
  return {
    answer: 'a',
    key_claims: [],
    uncertainty_notes: [],
    search_evidence: [],
    self_stability: 'stable',
    self_change_summary: '',
    peer_review: peerReview,
  };
}

describe('buildDisagreementMatrix', () => {
  it('多 agent 多主题分歧', () => {
    const outputs = new Map([
      [
        'claude',
        output([
          {
            agent: 'codex',
            agree: false,
            agreement_basis: '',
            disagreements: [{ claim: '首选型号', my_view: '我选 G20S', type: 'factual' }],
          },
        ]),
      ],
      [
        'codex',
        output([
          {
            agent: 'claude',
            agree: false,
            agreement_basis: '',
            disagreements: [
              { claim: '首选型号', my_view: '我选 X2', type: 'factual' },
              { claim: '价格区间', my_view: '4000 元以内', type: 'reasoning' },
            ],
          },
        ]),
      ],
    ]);
    const m = buildDisagreementMatrix({ agentOutputs: outputs });
    expect(m.agents).toEqual(['claude', 'codex']);
    expect(m.rows).toHaveLength(2);
    const firstRow = m.rows.find((r) => r.claim === '首选型号');
    expect(firstRow).toBeDefined();
    expect(firstRow!.cells[0]!.view).toBe('我选 G20S');
    expect(firstRow!.cells[1]!.view).toBe('我选 X2');
  });

  it('无 disagreement → 空 rows', () => {
    const outputs = new Map([
      [
        'a',
        output([{ agent: 'b', agree: true, agreement_basis: 'ok', disagreements: [] }]),
      ],
    ]);
    const m = buildDisagreementMatrix({ agentOutputs: outputs });
    expect(m.rows).toHaveLength(0);
  });

  it('某 agent 对某主题未表态 → cell.hasView=false', () => {
    const outputs = new Map([
      [
        'a',
        output([
          {
            agent: 'b',
            agree: false,
            agreement_basis: '',
            disagreements: [{ claim: 'topic1', my_view: 'view-a', type: 'factual' }],
          },
        ]),
      ],
      [
        'b',
        output([
          { agent: 'a', agree: true, agreement_basis: 'ok', disagreements: [] },
          // b 没对 topic1 表态
        ]),
      ],
    ]);
    const m = buildDisagreementMatrix({ agentOutputs: outputs });
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]!.cells[0]!.hasView).toBe(true);
    expect(m.rows[0]!.cells[1]!.hasView).toBe(false);
  });
});

describe('renderMatrixMarkdown', () => {
  it('标准表格：列头 + 分隔行 + 数据行', () => {
    const matrix = {
      agents: ['claude', 'codex'],
      rows: [
        {
          claim: 'topic1',
          cells: [
            { hasView: true, view: 'view-a' },
            { hasView: false, view: '' },
          ],
        },
      ],
    };
    const md = renderMatrixMarkdown(matrix);
    expect(md).toContain('| 分歧点 | claude | codex |');
    expect(md).toContain('| --- | --- | --- |');
    expect(md).toContain('| topic1 | view-a | — |');
  });

  it('自定义列头 i18n', () => {
    const matrix = {
      agents: ['a'],
      rows: [
        {
          claim: 'x',
          cells: [{ hasView: true, view: 'y' }],
        },
      ],
    };
    const md = renderMatrixMarkdown(matrix, 'Disagreements');
    expect(md).toContain('| Disagreements | a |');
  });

  it('空 rows → fallback 文案', () => {
    const md = renderMatrixMarkdown({ agents: ['a'], rows: [] });
    expect(md).toContain('无显著分歧');
  });

  it('单元格中的 | 与换行被转义', () => {
    const md = renderMatrixMarkdown({
      agents: ['a'],
      rows: [
        {
          claim: 'topic | with pipe',
          cells: [{ hasView: true, view: 'line1\nline2' }],
        },
      ],
    });
    expect(md).toContain('topic \\| with pipe');
    expect(md).toContain('line1 line2');
  });
});
