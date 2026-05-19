import { describe, expect, it } from 'vitest';
import { isValidBcp47, normalizeBcp47 } from '../../../src/shared/lang/bcp47.js';

describe('isValidBcp47', () => {
  it('接受合法的 2 字母 language tag', () => {
    expect(isValidBcp47('en')).toBe(true);
    expect(isValidBcp47('ja')).toBe(true);
  });

  it('接受 language-script 组合（zh-Hans / zh-Hant）', () => {
    expect(isValidBcp47('zh-Hans')).toBe(true);
    expect(isValidBcp47('zh-Hant')).toBe(true);
  });

  it('接受 language-region 组合（pt-BR）', () => {
    expect(isValidBcp47('pt-BR')).toBe(true);
  });

  it('拒绝空字符串', () => {
    expect(isValidBcp47('')).toBe(false);
  });

  it('拒绝关键字 auto / system（由更上层处理）', () => {
    expect(isValidBcp47('auto')).toBe(false);
    expect(isValidBcp47('system')).toBe(false);
  });

  it('拒绝含非法字符', () => {
    expect(isValidBcp47('en_US')).toBe(false); // 下划线非 BCP-47
    expect(isValidBcp47('123')).toBe(false);
  });
});

describe('normalizeBcp47', () => {
  it('language subtag 转小写', () => {
    expect(normalizeBcp47('EN')).toBe('en');
  });

  it('script subtag 首字母大写', () => {
    expect(normalizeBcp47('zh-hans')).toBe('zh-Hans');
    expect(normalizeBcp47('zh-HANS')).toBe('zh-Hans');
  });

  it('region subtag 大写', () => {
    expect(normalizeBcp47('pt-br')).toBe('pt-BR');
  });

  it('保留合法 canonical 形式不变', () => {
    expect(normalizeBcp47('zh-Hans')).toBe('zh-Hans');
    expect(normalizeBcp47('pt-BR')).toBe('pt-BR');
  });
});
