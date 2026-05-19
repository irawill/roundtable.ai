import { describe, expect, it } from 'vitest';
import {
  computeCjkRatio,
  fallbackHeuristicLanguage,
  isMostlyCjk,
} from '../../src/lang/heuristic.js';

describe('isMostlyCjk', () => {
  it('纯中文 → true', () => {
    expect(isMostlyCjk('推荐扫地机器人，预算 3000 元')).toBe(true);
  });

  it('纯英文 → false', () => {
    expect(isMostlyCjk('Recommend a robot vacuum cleaner with a budget of $300')).toBe(false);
  });

  it('日文 → true（含平假名 / 片假名）', () => {
    expect(isMostlyCjk('ロボット掃除機をおすすめしてください')).toBe(true);
  });

  it('韩文 → true', () => {
    expect(isMostlyCjk('로봇 청소기 추천해 주세요')).toBe(true);
  });

  it('中英混合 ≥ 50% 中文 → true', () => {
    // CJK: 帮我推荐一款扫地机器人，预算 3000 块（10 中文 + 1 中文标点）
    // Non-CJK: 3000 块 = 4 数字 → 总 15 非空白；CJK 11 / 15 ≈ 73%
    expect(isMostlyCjk('帮我推荐一款扫地机器人，预算 3000 块')).toBe(true);
  });

  it('中英混合 < 50% 中文 → false', () => {
    expect(isMostlyCjk('I want a 扫地机器人 that supports mopping in my living room')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(isMostlyCjk('')).toBe(false);
  });

  it('只 200 字符内统计：超出后的内容不影响', () => {
    const longCjk = '推荐'.repeat(20); // 40 chars (CJK only)
    const longEn = 'word '.repeat(50); // ~250 chars (English)
    // 前 200 字符 = 40 中文 + 160 英文（约）→ 中文占比 < 50%
    expect(isMostlyCjk(longCjk + longEn)).toBe(false);
  });
});

describe('computeCjkRatio', () => {
  it('返回 0..1 之间的值', () => {
    expect(computeCjkRatio('hello')).toBe(0);
    const ratio = computeCjkRatio('hi 你');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('空字符串 → 0', () => {
    expect(computeCjkRatio('')).toBe(0);
  });

  it('全空白 → 0（避免 NaN）', () => {
    expect(computeCjkRatio('   ')).toBe(0);
  });
});

describe('fallbackHeuristicLanguage', () => {
  it('CJK 占比 ≥ 50% → zh-Hans', () => {
    expect(
      fallbackHeuristicLanguage({ rawQuestion: '推荐扫地机器人', systemLang: 'en' }),
    ).toBe('zh-Hans');
  });

  it('CJK 占比 < 50% → systemLang', () => {
    expect(
      fallbackHeuristicLanguage({
        rawQuestion: 'Recommend a vacuum',
        systemLang: 'en',
      }),
    ).toBe('en');
    expect(
      fallbackHeuristicLanguage({
        rawQuestion: 'Recommend a vacuum',
        systemLang: 'ja',
      }),
    ).toBe('ja');
  });
});
