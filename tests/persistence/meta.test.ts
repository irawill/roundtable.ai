import { describe, expect, it } from 'vitest';
import { buildMetaLanguage, buildRedactor } from '../../src/persistence/meta.js';
import type { LanguageState } from '../../src/lang/types.js';

describe('buildMetaLanguage', () => {
  it('把 LanguageState 拍平为 meta.json.language 形态', () => {
    const state: LanguageState = {
      system: 'zh-Hans',
      requested_output: 'auto',
      resolved_output: 'zh-Hans',
      resolved_ui: 'zh-Hans',
      source: 'auto_detected',
      confidence: 0.95,
      fallback_used: false,
    };
    const m = buildMetaLanguage(state);
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
});

describe('buildRedactor', () => {
  it('空 patterns → 返回原样', () => {
    const redact = buildRedactor([]);
    expect(redact('sk-abc123')).toBe('sk-abc123');
  });

  it('单 pattern 替换为 [REDACTED]', () => {
    const redact = buildRedactor(['sk-[A-Za-z0-9]{4,}']);
    expect(redact('my key is sk-abc12345')).toBe('my key is [REDACTED]');
  });

  it('多 pattern 依次替换', () => {
    const redact = buildRedactor(['sk-[A-Za-z0-9]+', 'token=[A-Za-z0-9]+']);
    expect(redact('keys: sk-aaa and token=bbb')).toBe('keys: [REDACTED] and [REDACTED]');
  });

  it('null 输入 → null', () => {
    const redact = buildRedactor(['x']);
    expect(redact(null)).toBeNull();
  });

  it('非法正则跳过不抛错', () => {
    const redact = buildRedactor(['[invalid', 'sk-\\d+']);
    expect(redact('sk-12345')).toBe('[REDACTED]');
  });

  it('全局替换（一行多个匹配）', () => {
    const redact = buildRedactor(['sk-\\d+']);
    expect(redact('sk-111 and sk-222')).toBe('[REDACTED] and [REDACTED]');
  });
});
