import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadJsAdapters } from '../../src/adapters/js-loader.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rtai-js-loader-test-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMjs(name: string, content: string, mode = 0o600): string {
  const path = join(dir, name);
  writeFileSync(path, content, { encoding: 'utf8', mode });
  // writeFileSync mode 会被 umask 屏蔽，显式 chmod 保证位精确
  chmodSync(path, mode);
  return path;
}

const ADAPTER_TEMPLATE = `
class TestAdapter {
  name = 'test_adapter';
  capabilities = ['web_search'];
  roleSuitability = { enhancer: 'high', executor: 'high' };
  async binaryAvailable() { return true; }
  async version() { return '1.0.0'; }
  async detectAuthState() { return 'ok'; }
  authInstructions() { return 'login'; }
  async invoke(_args) { return { rawStdout: '', parsed: {}, usage: null, durationMs: 0 }; }
}
export default new TestAdapter();
`;

describe('loadJsAdapters — skip flag', () => {
  it('--no-adapters-mjs (skip=true) → 跳过加载', async () => {
    const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE);
    const r = await loadJsAdapters({
      path,
      skip: true,
      currentTrustedMtime: null,
    });
    expect(r.skipped).toBe(true);
    expect(r.adapters).toEqual([]);
  });
});

describe('loadJsAdapters — 文件缺失', () => {
  it('absent → skipped', async () => {
    const r = await loadJsAdapters({
      path: join(dir, 'nope.mjs'),
      skip: false,
      currentTrustedMtime: null,
    });
    expect(r.skipped).toBe(true);
    expect(r.adapters).toEqual([]);
  });
});

describe('loadJsAdapters — 信任流程', () => {
  it('首次（needs_confirmation, first_load）+ confirmTrust=true → 加载', async () => {
    const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE);
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: null,
      confirmTrust: vi.fn(async () => true),
    });
    expect(r.skipped).toBe(false);
    expect(r.adapters).toHaveLength(1);
    expect(r.trustNewlyConfirmed).toBe(true);
    expect(r.adapters[0]!.name).toBe('test_adapter');
  });

  it('首次 + confirmTrust=false → 跳过', async () => {
    const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE);
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: null,
      confirmTrust: vi.fn(async () => false),
    });
    expect(r.skipped).toBe(true);
    expect(r.adapters).toEqual([]);
  });

  it('默认不提供 confirmTrust → 拒绝（非交互保守）', async () => {
    const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE);
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: null,
    });
    expect(r.skipped).toBe(true);
  });

  it('mtime 匹配 trusted → 直接加载', async () => {
    const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE);
    const stat = statSync(path);
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: Math.floor(stat.mtimeMs),
    });
    expect(r.skipped).toBe(false);
    expect(r.adapters).toHaveLength(1);
    expect(r.trustNewlyConfirmed).toBe(false);
  });
});

describe('loadJsAdapters — default 形态', () => {
  it('default 是 Array of adapters', async () => {
    const content = `
${ADAPTER_TEMPLATE.replace('TestAdapter', 'A').replace("'test_adapter'", "'a1'").replace('export default new TestAdapter();', '')}
class A2 {
  name = 'a2';
  capabilities = [];
  roleSuitability = { enhancer: 'low', executor: 'low' };
  async binaryAvailable() { return false; }
  async version() { return '0'; }
  async detectAuthState() { return 'unknown'; }
  authInstructions() { return ''; }
  async invoke() { return { rawStdout: '', parsed: {}, usage: null, durationMs: 0 }; }
}
export default [new A(), new A2()];
`;
    const path = writeMjs('adapters.mjs', content);
    const stat = statSync(path);
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: Math.floor(stat.mtimeMs),
    });
    expect(r.adapters).toHaveLength(2);
    expect(r.adapters.map((a) => a.name)).toEqual(['a1', 'a2']);
  });

  it('default 缺失 → errors 含说明', async () => {
    const path = writeMjs('adapters.mjs', '// no export');
    const stat = statSync(path);
    const warned: string[] = [];
    const r = await loadJsAdapters({
      path,
      skip: false,
      currentTrustedMtime: Math.floor(stat.mtimeMs),
      warn: (m) => warned.push(m),
    });
    expect(r.adapters).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(warned.join(' ')).toContain('default');
  });
});

if (platform() !== 'win32') {
  describe('loadJsAdapters — unsafe permissions', () => {
    it('other 可写 → 拒绝加载 + warn', async () => {
      const path = writeMjs('adapters.mjs', ADAPTER_TEMPLATE, 0o606);
      const warned: string[] = [];
      const r = await loadJsAdapters({
        path,
        skip: false,
        currentTrustedMtime: null,
        warn: (m) => warned.push(m),
      });
      expect(r.skipped).toBe(true);
      expect(r.adapters).toEqual([]);
      expect(warned.join(' ')).toContain('chmod 600');
    });
  });
}
