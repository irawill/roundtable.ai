import { describe, expect, it } from 'vitest';
import {
  buildLanguageList,
  buildLanguageMeta,
  buildLanguageShow,
  matchesLangFilter,
  normalizeFallbackLang,
  normalizeLangForPrefs,
  normalizeUiLang,
} from '../../src/lang/meta.js';
import type { LanguageState } from '../../src/lang/types.js';

const sampleState: LanguageState = {
  system: 'zh-Hans',
  requested_output: 'auto',
  resolved_output: 'zh-Hans',
  resolved_ui: 'zh-Hans',
  source: 'auto_detected',
  confidence: 0.95,
  fallback_used: false,
};

describe('buildLanguageMeta', () => {
  it('把 LanguageState 拍平为 meta 形态', () => {
    const m = buildLanguageMeta(sampleState);
    expect(m).toEqual({
      system: 'zh-Hans',
      requested_output: 'auto',
      resolved_output: 'zh-Hans',
      resolved_ui: 'zh-Hans',
      source: 'auto_detected',
      confidence: 0.95,
      fallback_used: false,
    });
  });

  it('confidence=null 透传', () => {
    const m = buildLanguageMeta({ ...sampleState, source: 'cli_override', confidence: null });
    expect(m.confidence).toBeNull();
  });
});

describe('matchesLangFilter', () => {
  it('完全匹配 → true', () => {
    expect(matchesLangFilter('zh-Hans', 'zh-Hans')).toBe(true);
  });

  it('alias normalize 后匹配', () => {
    expect(matchesLangFilter('简中', 'zh-Hans')).toBe(true);
    expect(matchesLangFilter('zh', 'zh-Hans')).toBe(true);
    expect(matchesLangFilter('jp', 'ja')).toBe(true);
  });

  it('大小写不规范但 normalize 后匹配', () => {
    expect(matchesLangFilter('Zh-hans', 'zh-Hans')).toBe(true);
  });

  it('不同语言 → false', () => {
    expect(matchesLangFilter('en', 'zh-Hans')).toBe(false);
  });

  it('关键字 auto / system 不参与 filter（history 已是 resolved）→ false', () => {
    expect(matchesLangFilter('auto', 'zh-Hans')).toBe(false);
    expect(matchesLangFilter('system', 'zh-Hans')).toBe(false);
  });
});

describe('buildLanguageShow', () => {
  it('含所有 7 个字段', () => {
    const s = buildLanguageShow(sampleState);
    expect(s).toContain('system:');
    expect(s).toContain('requested_output:');
    expect(s).toContain('resolved_output:');
    expect(s).toContain('resolved_ui:');
    expect(s).toContain('source:');
    expect(s).toContain('confidence:');
    expect(s).toContain('fallback_used:');
  });

  it('confidence=null 显示 "n/a"', () => {
    const s = buildLanguageShow({ ...sampleState, confidence: null });
    expect(s).toContain('n/a');
  });
});

describe('buildLanguageList', () => {
  it('含 10 个内置翻译包名', () => {
    const s = buildLanguageList();
    for (const tag of ['en', 'zh-Hans', 'zh-Hant', 'ja', 'ko', 'es', 'fr', 'de', 'pt-BR', 'ru']) {
      expect(s).toContain(tag);
    }
  });

  it('含 quality 标签（[verified] / [community]）', () => {
    const s = buildLanguageList();
    expect(s).toContain('[verified]');
    expect(s).toContain('[community]');
  });

  it('含 auto / system 关键字说明', () => {
    const s = buildLanguageList();
    expect(s).toContain('`auto`');
    expect(s).toContain('`system`');
  });
});

describe('normalizeLangForPrefs', () => {
  it('合法 BCP-47 → ok', () => {
    expect(normalizeLangForPrefs('zh-Hans')).toEqual({ kind: 'ok', value: 'zh-Hans' });
  });

  it('alias → ok normalize', () => {
    expect(normalizeLangForPrefs('简中')).toEqual({ kind: 'ok', value: 'zh-Hans' });
  });

  it('关键字 auto / system → ok（保留关键字）', () => {
    expect(normalizeLangForPrefs('auto')).toEqual({ kind: 'ok', value: 'auto' });
    expect(normalizeLangForPrefs('system')).toEqual({ kind: 'ok', value: 'system' });
  });

  it('非法 → error', () => {
    const r = normalizeLangForPrefs('xxxxxx');
    expect(r.kind).toBe('error');
  });
});

describe('normalizeFallbackLang', () => {
  it('合法 BCP-47 + 内置 → ok', () => {
    expect(normalizeFallbackLang('en')).toEqual({ kind: 'ok', value: 'en' });
    expect(normalizeFallbackLang('ja')).toEqual({ kind: 'ok', value: 'ja' });
  });

  it('合法 BCP-47 但非内置 → error', () => {
    const r = normalizeFallbackLang('vi');
    expect(r.kind).toBe('error');
  });

  it('关键字 auto / system → error', () => {
    expect(normalizeFallbackLang('auto').kind).toBe('error');
    expect(normalizeFallbackLang('system').kind).toBe('error');
  });
});

describe('normalizeUiLang', () => {
  it('system / match_output 关键字 → ok', () => {
    expect(normalizeUiLang('system')).toEqual({ kind: 'ok', value: 'system' });
    expect(normalizeUiLang('match_output')).toEqual({ kind: 'ok', value: 'match_output' });
  });

  it('合法 BCP-47 → ok', () => {
    expect(normalizeUiLang('zh-Hans')).toEqual({ kind: 'ok', value: 'zh-Hans' });
  });

  it('非法 → error', () => {
    expect(normalizeUiLang('xxxxxx').kind).toBe('error');
  });
});
