import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluateAdaptersMjsTrust } from '../../src/security/adapters-mjs-trust.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rtai-trust-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMjs(name: string, content = 'export default []', mode = 0o600): string {
  const path = join(dir, name);
  writeFileSync(path, content, { encoding: 'utf8', mode });
  // writeFileSync 的 mode 会被 umask 屏蔽，显式 chmod 保证位精确
  chmodSync(path, mode);
  return path;
}

describe('evaluateAdaptersMjsTrust', () => {
  it('文件不存在 → absent', () => {
    const r = evaluateAdaptersMjsTrust({
      path: join(dir, 'nope.mjs'),
      currentTrustedMtime: null,
    });
    expect(r.kind).toBe('absent');
  });

  it('文件存在且 mtime 匹配 trusted → trusted', () => {
    const path = writeMjs('adapters.mjs');
    const stat = statSync(path);
    const r = evaluateAdaptersMjsTrust({
      path,
      currentTrustedMtime: Math.floor(stat.mtimeMs),
    });
    expect(r.kind).toBe('trusted');
  });

  it('trusted_mtime=null（首次） → needs_confirmation (first_load)', () => {
    const path = writeMjs('adapters.mjs');
    const r = evaluateAdaptersMjsTrust({
      path,
      currentTrustedMtime: null,
    });
    expect(r.kind).toBe('needs_confirmation');
    if (r.kind === 'needs_confirmation') {
      expect(r.reason).toBe('first_load');
    }
  });

  it('mtime 变化 → needs_confirmation (mtime_changed)', () => {
    const path = writeMjs('adapters.mjs');
    const r = evaluateAdaptersMjsTrust({
      path,
      currentTrustedMtime: 1, // 旧 mtime
    });
    expect(r.kind).toBe('needs_confirmation');
    if (r.kind === 'needs_confirmation') {
      expect(r.reason).toBe('mtime_changed');
    }
  });

  if (platform() !== 'win32') {
    it('other 可写权限 → unsafe_permissions', () => {
      const path = writeMjs('adapters.mjs', 'export default []', 0o606);
      const r = evaluateAdaptersMjsTrust({ path, currentTrustedMtime: null });
      expect(r.kind).toBe('unsafe_permissions');
      if (r.kind === 'unsafe_permissions') {
        expect(r.warning).toContain('chmod 600');
      }
    });

    it('group 可写权限 → unsafe_permissions', () => {
      const path = writeMjs('adapters.mjs', 'export default []', 0o660);
      // 注：chmod 后立刻测；某些文件系统会忽略 group 位，但 macOS / Linux 应当生效
      const stat = statSync(path);
      if ((stat.mode & 0o020) === 0o020) {
        const r = evaluateAdaptersMjsTrust({ path, currentTrustedMtime: null });
        expect(r.kind).toBe('unsafe_permissions');
      }
    });
  }
});
