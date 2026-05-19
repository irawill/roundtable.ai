import { describe, expect, it } from 'vitest';
import { PrefsFileSchema, defaultPrefs } from '../../src/config/schemas/prefs.js';

describe('defaultPrefs', () => {
  it('返回完整默认值（覆盖 §setup-wizard 兜底缺失配置 Requirement）', () => {
    const p = defaultPrefs();
    expect(p.defaults.max_rounds).toBe(4);
    expect(p.defaults.min_rounds).toBe(2);
    expect(p.defaults.max_total_seconds).toBe(600);
    expect(p.defaults.abort_on_exceed).toBe(false);
    expect(p.ui.tui).toBe('on');
    expect(p.ui.web_view).toBe('on');
    expect(p.ui.web_port).toBe(7421);
    expect(p.ui.verbosity).toBe('normal');
    expect(p.language.output).toBe('auto');
    expect(p.language.ui).toBe('system');
    expect(p.language.fallback).toBe('en');
    expect(p.language.community_pack_notice).toBe('on');
    expect(p.editor.command).toBe('$EDITOR');
    expect(p.history.retain_runs).toBe('unlimited');
    expect(p.history.redact_patterns).toEqual([]);
    expect(p.security.adapters_mjs_trusted_mtime).toBeNull();
    expect(p.upgrade.check).toBe('on');
    expect(p.auth_recovery_policy).toBe('skip');
    expect(p.cli.primary_name).toBe('rtai');
    expect(p.cli.primary_status).toBe('pending');
    expect(p.cli.short_alias_status).toBe('pending');
  });
});

describe('PrefsFileSchema — retain_runs', () => {
  it('接受 "unlimited"', () => {
    const r = PrefsFileSchema.safeParse({ history: { retain_runs: 'unlimited' } });
    expect(r.success).toBe(true);
  });

  it('接受 "last_100" / "last_5"', () => {
    expect(
      PrefsFileSchema.safeParse({ history: { retain_runs: 'last_100' } }).success,
    ).toBe(true);
    expect(PrefsFileSchema.safeParse({ history: { retain_runs: 'last_5' } }).success).toBe(true);
  });

  it('接受 "ttl_30days"', () => {
    expect(
      PrefsFileSchema.safeParse({ history: { retain_runs: 'ttl_30days' } }).success,
    ).toBe(true);
  });

  it('拒绝非法 retain_runs 形态', () => {
    expect(PrefsFileSchema.safeParse({ history: { retain_runs: 'last_' } }).success).toBe(false);
    expect(
      PrefsFileSchema.safeParse({ history: { retain_runs: 'ttl_30' } }).success,
    ).toBe(false);
    expect(
      PrefsFileSchema.safeParse({ history: { retain_runs: 'whatever' } }).success,
    ).toBe(false);
  });
});

describe('PrefsFileSchema — 跨段一致性', () => {
  it('defaults.max_rounds < min_rounds 报错', () => {
    const r = PrefsFileSchema.safeParse({
      defaults: { max_rounds: 1, min_rounds: 5 },
    });
    expect(r.success).toBe(false);
  });
});

describe('PrefsFileSchema — auth_recovery_policy', () => {
  it('接受 skip / abort 两个值', () => {
    expect(PrefsFileSchema.safeParse({ auth_recovery_policy: 'skip' }).success).toBe(true);
    expect(PrefsFileSchema.safeParse({ auth_recovery_policy: 'abort' }).success).toBe(true);
  });

  it('拒绝其他值', () => {
    expect(PrefsFileSchema.safeParse({ auth_recovery_policy: 'retry' }).success).toBe(false);
  });
});

describe('PrefsFileSchema — web_view', () => {
  it('接受 off / print_url_only / on 三档', () => {
    for (const v of ['off', 'print_url_only', 'on']) {
      expect(PrefsFileSchema.safeParse({ ui: { web_view: v } }).success).toBe(true);
    }
  });

  it('拒绝其他值', () => {
    expect(PrefsFileSchema.safeParse({ ui: { web_view: 'maybe' } }).success).toBe(false);
  });

  it('web_port 在 1..65535', () => {
    expect(PrefsFileSchema.safeParse({ ui: { web_port: 0 } }).success).toBe(false);
    expect(PrefsFileSchema.safeParse({ ui: { web_port: 65536 } }).success).toBe(false);
    expect(PrefsFileSchema.safeParse({ ui: { web_port: 7421 } }).success).toBe(true);
  });
});
