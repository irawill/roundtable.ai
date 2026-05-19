import { describe, expect, it } from 'vitest';
import {
  LANGUAGE_CONFIDENCE_THRESHOLD,
  buildConfirmationPrompt,
  needsLanguageConfirmation,
} from '../../src/lang/confidence.js';

describe('needsLanguageConfirmation', () => {
  it('阈值 = 0.6', () => {
    expect(LANGUAGE_CONFIDENCE_THRESHOLD).toBe(0.6);
  });

  it('confidence >= 0.6 → false', () => {
    expect(needsLanguageConfirmation(0.6)).toBe(false);
    expect(needsLanguageConfirmation(0.95)).toBe(false);
  });

  it('confidence < 0.6 → true', () => {
    expect(needsLanguageConfirmation(0.5)).toBe(true);
    expect(needsLanguageConfirmation(0.0)).toBe(true);
  });
});

describe('buildConfirmationPrompt', () => {
  it('zh-Hans → 含 "简体中文" 显示名', () => {
    const s = buildConfirmationPrompt('zh-Hans');
    expect(s).toContain('简体中文');
    expect(s).toContain('zh-Hans');
    expect(s).toContain('--lang');
    expect(s).toContain('Y/n');
  });

  it('ja → 含 "日本語"', () => {
    const s = buildConfirmationPrompt('ja');
    expect(s).toContain('日本語');
  });

  it('unknown tag → 用 BCP-47 标签本身作为显示名', () => {
    const s = buildConfirmationPrompt('vi');
    expect(s).toContain('vi');
  });
});
