import { describe, expect, it } from 'vitest';
import { computeConsensus, normalizeClaim } from '../../src/finalizer/normalize.js';

describe('normalizeClaim', () => {
  it('去除首尾空白', () => {
    expect(normalizeClaim('  hello  ')).toBe('hello');
  });

  it('全角句号 → 半角', () => {
    expect(normalizeClaim('石头 G20S 推荐。')).toBe('石头 G20S 推荐.');
  });

  it('多种全角标点 normalize', () => {
    expect(normalizeClaim('A，B；C：D！E？')).toBe('A,B;C:D!E?');
  });

  it('连续多空白合并为 1', () => {
    expect(normalizeClaim('a   b\t\tc')).toBe('a b c');
  });

  it('全角引号 normalize', () => {
    expect(normalizeClaim('“hello”')).toBe('"hello"');
  });
});

describe('computeConsensus — 字面 set 交集', () => {
  it('多 agent 共同 claim → 进入共识', () => {
    const r = computeConsensus(
      new Map([
        ['claude', ['石头 G20S 推荐', '需要大电池']],
        ['codex', ['石头 G20S 推荐', '需要上下水']],
        ['gemini', ['石头 G20S 推荐']],
      ]),
    );
    expect(r).toEqual(['石头 G20S 推荐']);
  });

  it('标点 / 空白差异 normalize 后视为同 claim', () => {
    const r = computeConsensus(
      new Map([
        ['a', ['石头 G20S 推荐。']],
        ['b', ['石头 G20S 推荐.']],
        ['c', ['石头  G20S  推荐.']],
      ]),
    );
    expect(r).toEqual(['石头 G20S 推荐.']);
  });

  it('无共同 claim → 空数组', () => {
    const r = computeConsensus(
      new Map([
        ['a', ['claim A']],
        ['b', ['claim B']],
      ]),
    );
    expect(r).toEqual([]);
  });

  it('单 agent → 空（无法谈共识）', () => {
    const r = computeConsensus(new Map([['a', ['claim']]]));
    expect(r).toEqual([]);
  });

  it('空 map → 空', () => {
    expect(computeConsensus(new Map())).toEqual([]);
  });
});
