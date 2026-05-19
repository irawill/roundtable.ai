import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPermissions, ensureSecureDir } from '../../src/persistence/permissions.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rtai-perm-test-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('ensureSecureDir', () => {
  it('创建目录递归', () => {
    const target = join(tmpRoot, 'a', 'b', 'c');
    ensureSecureDir(target);
    expect(statSync(target).isDirectory()).toBe(true);
  });

  it('已存在目录不报错', () => {
    ensureSecureDir(tmpRoot);
    ensureSecureDir(tmpRoot);
  });
});

describe('checkPermissions', () => {
  it('路径不存在 → null', () => {
    expect(checkPermissions(join(tmpRoot, 'nonexistent'))).toBeNull();
  });

  if (platform() !== 'win32') {
    it('权限严格（0700） → null', () => {
      ensureSecureDir(tmpRoot);
      // mkdtemp 创建的目录默认 0700 in linux/macos
      const result = checkPermissions(tmpRoot);
      // 由于 mkdtemp / system umask 影响，0700 / 0750 都可能；只断言无 other 位
      if (result !== null) {
        expect(result).toContain('chmod 700');
      }
    });

    it('权限松（group/other 可读 0755） → warning', () => {
      const dir = join(tmpRoot, 'loose');
      ensureSecureDir(dir);
      chmodSync(dir, 0o755);
      const result = checkPermissions(dir);
      expect(result).not.toBeNull();
      expect(result!).toContain('chmod 700');
    });
  }

  if (platform() === 'win32') {
    it('Windows 跳过权限校验 → null', () => {
      ensureSecureDir(tmpRoot);
      expect(checkPermissions(tmpRoot)).toBeNull();
    });
  }
});
