import { describe, expect, it } from 'vitest';
import { buildLanguageInstruction } from '../../src/lang/instruction.js';

describe('buildLanguageInstruction', () => {
  it('含 BCP-47 标签与显示名', () => {
    const s = buildLanguageInstruction({ resolvedOutputLanguage: 'zh-Hans', round: 1 });
    expect(s).toContain('zh-Hans');
    expect(s).toContain('简体中文');
  });

  it('含 5 类自然语言字段名', () => {
    const s = buildLanguageInstruction({ resolvedOutputLanguage: 'en', round: 1 });
    expect(s).toContain('answer');
    expect(s).toContain('key_claims');
    expect(s).toContain('uncertainty_notes');
    expect(s).toContain('peer_review');
    expect(s).toContain('agreement_basis');
    expect(s).toContain('disagreements');
  });

  it('明示不翻译代码 / 标识符 / API / URL / 错误码 / 版本号 / 公认专有名词', () => {
    const s = buildLanguageInstruction({ resolvedOutputLanguage: 'zh-Hans', round: 1 });
    expect(s).toContain('代码');
    expect(s).toContain('标识符');
    expect(s).toContain('API');
    expect(s).toContain('URL');
    expect(s).toContain('错误码');
    expect(s).toContain('版本号');
    expect(s).toContain('React');
    expect(s).toContain('Kubernetes');
  });

  it('Round 1 不含 "重申" 提示', () => {
    const s = buildLanguageInstruction({ resolvedOutputLanguage: 'en', round: 1 });
    expect(s).not.toContain('重申');
  });

  it('Round 2+ 含重申提示', () => {
    const s = buildLanguageInstruction({ resolvedOutputLanguage: 'en', round: 2 });
    expect(s).toContain('重申');
  });
});
