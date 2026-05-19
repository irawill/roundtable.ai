import { describe, expect, it } from 'vitest';
import { RolesFileSchema } from '../../src/config/schemas/roles.js';

describe('RolesFileSchema — enhancer', () => {
  it('接受 mode=fixed + model 合法', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'fixed', model: 'claude' },
      executor: { mode: 'fixed', model: 'claude' },
    });
    expect(r.success).toBe(true);
  });

  it('拒绝 enhancer.mode != fixed', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'rotate', model: 'claude' },
      executor: { mode: 'fixed', model: 'claude' },
    });
    expect(r.success).toBe(false);
  });

  it('拒绝 enhancer.model 缺失', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'fixed' },
      executor: { mode: 'fixed', model: 'claude' },
    });
    expect(r.success).toBe(false);
  });
});

describe('RolesFileSchema — executor', () => {
  it('接受 4 种 mode', () => {
    for (const mode of ['fixed', 'rotate', 'random', 'per_scene'] as const) {
      const data: { mode: typeof mode; model?: string } = { mode };
      if (mode === 'fixed') data.model = 'claude';
      const r = RolesFileSchema.safeParse({
        enhancer: { mode: 'fixed', model: 'codex' },
        executor: data,
      });
      expect(r.success, `mode=${mode} 应通过`).toBe(true);
    }
  });

  it('拒绝 executor.mode 非 4 个合法值', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'fixed', model: 'claude' },
      executor: { mode: 'whatever' },
    });
    expect(r.success).toBe(false);
  });

  it('拒绝 executor.mode = fixed 但 model 缺失', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'fixed', model: 'claude' },
      executor: { mode: 'fixed' },
    });
    expect(r.success).toBe(false);
  });

  it('接受 executor.mode = rotate 缺省 model（被忽略）', () => {
    const r = RolesFileSchema.safeParse({
      enhancer: { mode: 'fixed', model: 'claude' },
      executor: { mode: 'rotate' },
    });
    expect(r.success).toBe(true);
  });
});
