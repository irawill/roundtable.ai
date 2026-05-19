import { describe, expect, it } from 'vitest';
import {
  LangResolverError,
  parseRequestedOutputLanguage,
  resolveAutoOutput,
  resolveExplicitOutput,
  resolveOutputForSingleAgentDirect,
} from '../../src/lang/resolver.js';

describe('parseRequestedOutputLanguage', () => {
  it('CLI flag 显式 BCP-47 → cli_override', () => {
    const r = parseRequestedOutputLanguage({ cliRaw: 'en', prefRaw: 'auto' });
    expect(r.request.value).toBe('en');
    expect(r.request.origin).toBe('cli_override');
  });

  it('CLI flag alias normalize（简中 → zh-Hans）', () => {
    const r = parseRequestedOutputLanguage({ cliRaw: '简中', prefRaw: 'auto' });
    expect(r.request.value).toBe('zh-Hans');
  });

  it('CLI flag 关键字 auto', () => {
    const r = parseRequestedOutputLanguage({ cliRaw: 'auto', prefRaw: 'en' });
    expect(r.request.value).toBe('auto');
    expect(r.request.origin).toBe('cli_override');
  });

  it('CLI flag 非法 → throw', () => {
    expect(() =>
      parseRequestedOutputLanguage({ cliRaw: 'xxxxxx', prefRaw: 'en' }),
    ).toThrow(LangResolverError);
  });

  it('CLI flag 未传 → 取 prefs.output（user_pref）', () => {
    const r = parseRequestedOutputLanguage({ prefRaw: 'zh-Hans' });
    expect(r.request.value).toBe('zh-Hans');
    expect(r.request.origin).toBe('user_pref');
  });

  it('prefs.output 非法 → fallback auto + warning', () => {
    const r = parseRequestedOutputLanguage({ prefRaw: 'xxxxxx' });
    expect(r.request.value).toBe('auto');
    expect(r.warning).toBeDefined();
  });

  it('prefs.output 别名 → normalize', () => {
    const r = parseRequestedOutputLanguage({ prefRaw: 'jp' });
    expect(r.request.value).toBe('ja');
  });
});

describe('resolveExplicitOutput', () => {
  it('显式 BCP-47 直接 resolve', () => {
    const r = resolveExplicitOutput({
      request: { value: 'zh-Hans', origin: 'cli_override' },
      systemLang: 'en',
    });
    expect(r.resolved).toBe('zh-Hans');
    expect(r.source).toBe('cli_override');
  });

  it('system 关键字 → systemLang', () => {
    const r = resolveExplicitOutput({
      request: { value: 'system', origin: 'user_pref' },
      systemLang: 'ja',
    });
    expect(r.resolved).toBe('ja');
    expect(r.source).toBe('user_pref');
  });

  it('auto 模式调用 → throw', () => {
    expect(() =>
      resolveExplicitOutput({
        request: { value: 'auto', origin: 'cli_override' },
        systemLang: 'en',
      }),
    ).toThrow(LangResolverError);
  });
});

describe('resolveAutoOutput', () => {
  it('confidence >= 0.6 → auto_detected', () => {
    const r = resolveAutoOutput({
      detectedLanguage: 'zh-Hans',
      confidence: 0.95,
      systemLang: 'en',
    });
    expect(r.resolved).toBe('zh-Hans');
    expect(r.source).toBe('auto_detected');
    expect(r.needsSystemConfirmation).toBe(false);
  });

  it('confidence < 0.6 → low_confidence_system_confirmed + needsConfirmation', () => {
    const r = resolveAutoOutput({
      detectedLanguage: 'zh-Hans',
      confidence: 0.5,
      systemLang: 'en',
    });
    expect(r.resolved).toBe('en'); // fallback 到 system_language
    expect(r.source).toBe('low_confidence_system_confirmed');
    expect(r.needsSystemConfirmation).toBe(true);
  });

  it('detectedLanguage 非法 BCP-47 → fallback systemLang', () => {
    const r = resolveAutoOutput({
      detectedLanguage: 'xxxxxx',
      confidence: 0.95,
      systemLang: 'en',
    });
    expect(r.resolved).toBe('en');
  });
});

describe('resolveOutputForSingleAgentDirect', () => {
  it('requested=auto → single_agent_system_default', () => {
    const r = resolveOutputForSingleAgentDirect({
      request: { value: 'auto', origin: 'user_pref' },
      systemLang: 'zh-Hans',
    });
    expect(r.resolved).toBe('zh-Hans');
    expect(r.source).toBe('single_agent_system_default');
  });

  it('requested=显式 → 走 explicit 逻辑（cli_override / user_pref）', () => {
    const r = resolveOutputForSingleAgentDirect({
      request: { value: 'en', origin: 'cli_override' },
      systemLang: 'zh-Hans',
    });
    expect(r.resolved).toBe('en');
    expect(r.source).toBe('cli_override');
  });

  it('requested=system → systemLang + 保留 origin source', () => {
    const r = resolveOutputForSingleAgentDirect({
      request: { value: 'system', origin: 'user_pref' },
      systemLang: 'ja',
    });
    expect(r.resolved).toBe('ja');
    expect(r.source).toBe('user_pref');
  });
});
