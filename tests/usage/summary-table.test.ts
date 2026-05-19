import { describe, expect, it } from 'vitest';
import {
  buildSummaryTable,
  formatTokenCount,
  renderSummaryMarkdown,
  renderTickerInline,
} from '../../src/usage/summary-table.js';

describe('formatTokenCount', () => {
  it('null → "-"', () => {
    expect(formatTokenCount(null)).toBe('-');
  });

  it('< 1000 → 整数', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('>= 1000 → k 单位（保留 1 位小数）', () => {
    expect(formatTokenCount(1000)).toBe('1.0k');
    expect(formatTokenCount(1234)).toBe('1.2k');
    expect(formatTokenCount(29343)).toBe('29.3k');
  });
});

describe('buildSummaryTable', () => {
  it('多 agent 多轮统计', () => {
    const matrix = {
      claude: {
        '1': { input_tokens: 100, output_tokens: 50, cached_input_tokens: 30, reasoning_tokens: 10 },
        '2': { input_tokens: 200, output_tokens: 80 },
      },
      codex: {
        '1': { input_tokens: 120, output_tokens: 60 },
      },
    };
    const t = buildSummaryTable(matrix);
    expect(t.rows).toHaveLength(2);
    const claude = t.rows.find((r) => r.agent === 'claude')!;
    expect(claude.rounds).toBe(2);
    expect(claude.input_tokens).toBe(300);
    expect(claude.cached_input_tokens).toBe(30);
    expect(claude.reasoning_tokens).toBe(10);

    expect(t.totalRow.agents).toBe(2);
    expect(t.totalRow.rounds).toBe(3);
    expect(t.totalRow.input_tokens).toBe(420);
  });

  it('null usage 不影响其他 agent 累加', () => {
    const matrix = {
      a: { '1': { input_tokens: 10, output_tokens: 5 } },
      b: { '1': null },
    };
    const t = buildSummaryTable(matrix);
    const a = t.rows.find((r) => r.agent === 'a')!;
    const b = t.rows.find((r) => r.agent === 'b')!;
    expect(a.input_tokens).toBe(10);
    expect(b.input_tokens).toBeNull();
    expect(b.total).toBeNull();
    expect(t.totalRow.input_tokens).toBe(10); // 仅累加 a
  });
});

describe('renderSummaryMarkdown', () => {
  it('表格含 TOTAL 行', () => {
    const md = renderSummaryMarkdown({
      rows: [
        {
          agent: 'claude',
          rounds: 2,
          input_tokens: 300,
          output_tokens: 130,
          cached_input_tokens: 30,
          reasoning_tokens: 10,
          total: 470,
        },
      ],
      totalRow: {
        agents: 1,
        rounds: 2,
        input_tokens: 300,
        output_tokens: 130,
        cached_input_tokens: 30,
        reasoning_tokens: 10,
        total: 470,
      },
    });
    expect(md).toContain('| Agent | Rounds | Input | Output | Cached | Reasoning | Total |');
    expect(md).toContain('claude');
    expect(md).toContain('**TOTAL**');
  });

  it('null 列显示 -', () => {
    const md = renderSummaryMarkdown({
      rows: [
        {
          agent: 'gemini',
          rounds: 1,
          input_tokens: null,
          output_tokens: null,
          cached_input_tokens: null,
          reasoning_tokens: null,
          total: null,
        },
      ],
      totalRow: {
        agents: 1,
        rounds: 1,
        input_tokens: null,
        output_tokens: null,
        cached_input_tokens: null,
        reasoning_tokens: null,
        total: null,
      },
    });
    expect(md).toMatch(/\| gemini \| 1 \| - \| - \| - \| - \| - \|/);
  });
});

describe('renderTickerInline', () => {
  it('正常 token 显示', () => {
    expect(renderTickerInline('claude', 1234, false)).toBe('claude=1.2k');
  });

  it('provisional 加 ~ 前缀', () => {
    expect(renderTickerInline('gemini', 9000, true)).toBe('gemini=~9.0k');
  });

  it('null 显示 -', () => {
    expect(renderTickerInline('gemini', null, false)).toBe('gemini=-');
  });
});
