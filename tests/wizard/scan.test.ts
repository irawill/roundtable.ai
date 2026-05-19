import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CLI_NAMES,
  KNOWN_THIRD_PARTY_CLI_NAMES,
  renderScanReport,
  scanKnownClis,
} from '../../src/wizard/scan.js';

describe('BUILTIN_CLI_NAMES + KNOWN_THIRD_PARTY_CLI_NAMES', () => {
  it('内置 3 个：claude / codex / gemini', () => {
    expect(BUILTIN_CLI_NAMES).toEqual(['claude', 'codex', 'gemini']);
  });

  it('第三方 v1 仅 kimi-cli', () => {
    expect(KNOWN_THIRD_PARTY_CLI_NAMES).toEqual(['kimi-cli']);
  });
});

describe('scanKnownClis', () => {
  it('返回 builtins / thirdParty map（值是 boolean）', () => {
    const r = scanKnownClis();
    expect(typeof r.builtins.claude).toBe('boolean');
    expect(typeof r.builtins.codex).toBe('boolean');
    expect(typeof r.builtins.gemini).toBe('boolean');
    expect(typeof r.thirdParty['kimi-cli']).toBe('boolean');
  });
});

describe('renderScanReport', () => {
  it('已安装 → ✓；未安装 → ✗', () => {
    const out = renderScanReport({
      builtins: { claude: true, codex: false, gemini: true },
      thirdParty: {},
    });
    expect(out).toContain('✓ claude');
    expect(out).toContain('✗ codex');
    expect(out).toContain('✓ gemini');
  });

  it('第三方 binary 装了 → ℹ 提示接入', () => {
    const out = renderScanReport({
      builtins: { claude: false, codex: false, gemini: false },
      thirdParty: { 'kimi-cli': true },
    });
    expect(out).toContain('ℹ kimi-cli');
    expect(out).toContain('models.yaml');
  });

  it('未安装 builtin → 含官方文档链接 hint', () => {
    const out = renderScanReport({
      builtins: { claude: false, codex: false, gemini: false },
      thirdParty: {},
    });
    expect(out).toContain('docs.anthropic.com');
    expect(out).toContain('github.com/openai/codex');
    expect(out).toContain('gemini-cli');
  });
});
