import { describe, expect, it, vi } from 'vitest';
import {
  checkRegistryVersion,
  startBackgroundUpgradeCheck,
} from '../../src/cli/upgrade.js';

describe('checkRegistryVersion — 网络注入', () => {
  it('fetch 失败 → null', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network error');
    }) as typeof fetch;
    const r = await checkRegistryVersion({ currentVersion: '0.1.0' });
    expect(r).toBeNull();
    globalThis.fetch = original;
  });

  it('200 + 同版本 → hasNewVersion=false', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.1.0' }),
    })) as unknown as typeof fetch;
    const r = await checkRegistryVersion({ currentVersion: '0.1.0' });
    expect(r).toEqual({ hasNewVersion: false, latest: '0.1.0' });
    globalThis.fetch = original;
  });

  it('200 + 不同版本 → hasNewVersion=true', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    })) as unknown as typeof fetch;
    const r = await checkRegistryVersion({ currentVersion: '0.1.0' });
    expect(r).toEqual({ hasNewVersion: true, latest: '0.2.0' });
    globalThis.fetch = original;
  });

  it('非 200 → null', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: false })) as unknown as typeof fetch;
    const r = await checkRegistryVersion({ currentVersion: '0.1.0' });
    expect(r).toBeNull();
    globalThis.fetch = original;
  });

  it('body 无 version 字段 → null', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    })) as unknown as typeof fetch;
    const r = await checkRegistryVersion({ currentVersion: '0.1.0' });
    expect(r).toBeNull();
    globalThis.fetch = original;
  });
});

describe('startBackgroundUpgradeCheck', () => {
  it('upgradeCheck=off → 立即返回 null（不发请求）', async () => {
    const r = await startBackgroundUpgradeCheck({
      upgradeCheck: 'off',
      currentVersion: '0.1.0',
    });
    expect(r).toBeNull();
  });

  it('upgradeCheck=on + 新版本 → 提示字符串', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.2.0' }),
    })) as unknown as typeof fetch;
    const r = await startBackgroundUpgradeCheck({
      upgradeCheck: 'on',
      currentVersion: '0.1.0',
    });
    expect(r).toContain('0.2.0');
    expect(r).toContain('rtai upgrade');
    globalThis.fetch = original;
  });

  it('upgradeCheck=on + 同版本 → null', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: '0.1.0' }),
    })) as unknown as typeof fetch;
    const r = await startBackgroundUpgradeCheck({
      upgradeCheck: 'on',
      currentVersion: '0.1.0',
    });
    expect(r).toBeNull();
    globalThis.fetch = original;
  });
});
