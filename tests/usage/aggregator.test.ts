import { describe, expect, it } from 'vitest';
import { UsageAggregator } from '../../src/usage/aggregator.js';

describe('UsageAggregator — 基础记录', () => {
  it('记录三家三轮的 usage', () => {
    const agg = new UsageAggregator();
    agg.record('claude', 1, { input_tokens: 100, output_tokens: 50 });
    agg.record('codex', 1, { input_tokens: 120, output_tokens: 60 });
    agg.record('claude', 2, { input_tokens: 200, output_tokens: 80 });

    const m = agg.getMatrix();
    expect(m.claude?.['1']?.input_tokens).toBe(100);
    expect(m.claude?.['2']?.output_tokens).toBe(80);
    expect(m.codex?.['1']?.input_tokens).toBe(120);
  });

  it('null usage 透传（CLI 不暴露 usage）', () => {
    const agg = new UsageAggregator();
    agg.record('gemini', 1, null);
    expect(agg.getMatrix().gemini?.['1']).toBeNull();
  });
});

describe('UsageAggregator — totals 计算', () => {
  it('累加非 null；null 跳过', () => {
    const agg = new UsageAggregator();
    agg.record('claude', 1, { input_tokens: 100, output_tokens: 50, cached_input_tokens: 20 });
    agg.record('claude', 2, { input_tokens: 200, output_tokens: 80 });
    agg.record('gemini', 1, null); // null 不计

    const totals = agg.computeTotals();
    expect(totals.byAgent.claude).toBe(100 + 50 + 20 + 200 + 80);
    expect(totals.byAgent.gemini).toBe(0);
    expect(totals.grand_total).toBe(totals.byAgent.claude!);
  });

  it('grand_total 仅累加非 null', () => {
    const agg = new UsageAggregator();
    agg.record('a', 1, { input_tokens: 10, output_tokens: 5 });
    agg.record('b', 1, null);
    agg.record('c', 1, { input_tokens: 20, output_tokens: 10 });

    expect(agg.computeTotals().grand_total).toBe(10 + 5 + 20 + 10);
  });
});

describe('UsageAggregator — getCumulative（TUI 实时 ticker）', () => {
  it('多轮累加 + provisional 透传', () => {
    const agg = new UsageAggregator();
    agg.record('claude', 1, {
      input_tokens: 100,
      output_tokens: 50,
      cached_input_tokens: 30,
      reasoning_tokens: 10,
    });
    agg.record('claude', 2, {
      input_tokens: 200,
      output_tokens: 80,
      provisional: true,
    });

    const cum = agg.getCumulative();
    expect(cum.claude?.input_tokens).toBe(300);
    expect(cum.claude?.output_tokens).toBe(130);
    expect(cum.claude?.cached_input_tokens).toBe(30);
    expect(cum.claude?.reasoning_tokens).toBe(10);
    expect(cum.claude?.total).toBe(300 + 130 + 30 + 10);
    expect(cum.claude?.provisional).toBe(true);
    expect(cum.claude?.roundsCounted).toBe(2);
  });

  it('全 null 轮 → input/output 均 null', () => {
    const agg = new UsageAggregator();
    agg.record('gemini', 1, null);
    agg.record('gemini', 2, null);
    const cum = agg.getCumulative();
    expect(cum.gemini?.input_tokens).toBeNull();
    expect(cum.gemini?.total).toBeNull();
    expect(cum.gemini?.roundsCounted).toBe(0);
  });
});

describe('UsageAggregator — build', () => {
  it('build 返回 meta.json 形态', () => {
    const agg = new UsageAggregator();
    agg.record('a', 1, { input_tokens: 10, output_tokens: 5 });
    agg.record('b', 1, null);
    const built = agg.build();
    expect(built.usage.a?.['1']?.input_tokens).toBe(10);
    expect(built.usage.b?.['1']).toBeNull();
    expect(built.usage_totals.a).toBe(15);
    expect(built.usage_totals.grand_total).toBe(15);
  });
});
