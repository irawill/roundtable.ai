import { describe, expect, it } from 'vitest';
import {
  finalizeUiLanguage,
  resolveProvisionalUi,
} from '../../src/lang/ui-resolver.js';

describe('resolveProvisionalUi — prefs.ui 单一值', () => {
  it('prefs.ui = system → system_language', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'system',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'auto',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('zh-Hans');
    expect(r.needsPostEnhancerFinalize).toBe(false);
  });

  it('prefs.ui = 显式 BCP-47 → 该值', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'en',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'zh-Hans',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('en');
    expect(r.needsPostEnhancerFinalize).toBe(false);
  });
});

describe('resolveProvisionalUi — prefs.ui = match_output', () => {
  it('match_output + prefs.output BCP-47 → prefs.output 值', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'match_output',
      systemLang: 'en',
      prefOutputRaw: 'ja',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('ja');
    expect(r.needsPostEnhancerFinalize).toBe(false);
  });

  it('match_output + prefs.output system → system_language', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'match_output',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'system',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('zh-Hans');
    expect(r.needsPostEnhancerFinalize).toBe(false);
  });

  it('match_output + prefs.output auto → system_language + needsPostEnhancerFinalize=true', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'match_output',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'auto',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('zh-Hans');
    expect(r.needsPostEnhancerFinalize).toBe(true);
  });
});

describe('resolveProvisionalUi — CLI --ui-lang override', () => {
  it('CLI 显式 BCP-47 击穿 prefs', () => {
    const r = resolveProvisionalUi({
      cliUiLangRaw: 'en',
      prefUiRaw: 'match_output',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'ja',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('en');
    expect(r.needsPostEnhancerFinalize).toBe(false);
  });

  it('CLI system → systemLang', () => {
    const r = resolveProvisionalUi({
      cliUiLangRaw: 'system',
      prefUiRaw: 'en',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'en',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('zh-Hans');
  });

  it('CLI auto 关键字非法 → 忽略 + warn，按 prefs.ui 解析', () => {
    const r = resolveProvisionalUi({
      cliUiLangRaw: 'auto',
      prefUiRaw: 'en',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'auto',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('en'); // 按 prefs.ui
    expect(r.warnings.some((w) => w.includes('--ui-lang'))).toBe(true);
  });
});

describe('resolveProvisionalUi — 翻译包缺失 fallback', () => {
  it('vi（v1 未内置）→ fallback en + warn', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'vi',
      systemLang: 'en',
      prefOutputRaw: 'en',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('en');
    expect(r.warnings.some((w) => w.includes('vi'))).toBe(true);
  });

  it('prefs.ui 非法 → fallback system_language + warn', () => {
    const r = resolveProvisionalUi({
      prefUiRaw: 'xxxxxx',
      systemLang: 'zh-Hans',
      prefOutputRaw: 'auto',
      fallbackLang: 'en',
    });
    expect(r.provisional_ui).toBe('zh-Hans');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('finalizeUiLanguage', () => {
  it('回填 resolved_output 为 resolved_ui', () => {
    const r = finalizeUiLanguage({
      provisional_ui: 'zh-Hans',
      resolved_output: 'ja',
      fallbackLang: 'en',
    });
    expect(r.resolved_ui).toBe('ja');
  });

  it('翻译包缺失时回退 fallback', () => {
    const r = finalizeUiLanguage({
      provisional_ui: 'en',
      resolved_output: 'vi',
      fallbackLang: 'en',
    });
    expect(r.resolved_ui).toBe('en');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
