import { describe, expect, it } from 'vitest';
import { buildRedactor, formatErrorLog } from '../../src/security/redact.js';

describe('buildRedactor (re-exported)', () => {
  it('正常替换 sk-... pattern', () => {
    const redact = buildRedactor(['sk-[A-Za-z0-9]{4,}']);
    expect(redact('my key is sk-abc12345')).toBe('my key is [REDACTED]');
  });
});

describe('formatErrorLog — 不含 prompt 内容', () => {
  it('含 run_id + adapter + category', () => {
    const s = formatErrorLog({
      run_id: 'abc',
      adapter: 'claude',
      category: 'timeout',
    });
    expect(s).toBe('[run_id=abc] adapter=claude error=timeout');
  });

  it('可选 detail（注意：调用方负责不传 prompt 内容）', () => {
    const s = formatErrorLog({
      run_id: 'abc',
      adapter: 'claude',
      category: 'parse_error',
      detail: 'schema mismatch at peer_review',
    });
    expect(s).toContain('detail=schema mismatch');
  });

  it('缺 run_id 时省略字段', () => {
    const s = formatErrorLog({ adapter: 'codex', category: 'auth_expired' });
    expect(s).toBe('adapter=codex error=auth_expired');
  });
});
