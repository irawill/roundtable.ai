import { describe, expect, it } from 'vitest';
import { translateEffort } from '../../../src/adapters/runtime/effort.js';

describe('translateEffort — 直接命中', () => {
  it('请求 level 在 mapping 中直接命中', () => {
    const r = translateEffort(
      {
        none: [],
        low: ['--effort', 'low'],
        medium: ['--effort', 'medium'],
        high: ['--effort', 'high'],
        max: ['--effort', 'max'],
      },
      'high',
    );
    expect(r.flags).toEqual(['--effort', 'high']);
    expect(r.effectiveLevel).toBe('high');
    expect(r.fellBack).toBe(false);
    expect(r.warning).toBeUndefined();
  });

  it('none 等于空数组', () => {
    const r = translateEffort({ none: [] }, 'none');
    expect(r.flags).toEqual([]);
    expect(r.fellBack).toBe(false);
  });
});

describe('translateEffort — fallback 最接近 level', () => {
  it('请求 max 但 mapping 只有 high → fallback high + warn', () => {
    const r = translateEffort(
      {
        low: ['--effort', 'low'],
        medium: ['--effort', 'medium'],
        high: ['--effort', 'high'],
      },
      'max',
    );
    expect(r.flags).toEqual(['--effort', 'high']);
    expect(r.effectiveLevel).toBe('high');
    expect(r.fellBack).toBe(true);
    expect(r.requestedLevel).toBe('max');
    expect(r.warning).toContain('max');
    expect(r.warning).toContain('high');
  });

  it('请求 none 但 mapping 只有 medium → fallback medium', () => {
    const r = translateEffort({ medium: ['--effort', 'medium'] }, 'none');
    expect(r.flags).toEqual(['--effort', 'medium']);
    expect(r.effectiveLevel).toBe('medium');
    expect(r.fellBack).toBe(true);
  });

  it('同距离时取序数更低（更保守）', () => {
    // 请求 medium，已声明 low / max（与 medium 距离均为 2）→ 取 low
    const r = translateEffort(
      { low: ['low-flag'], max: ['max-flag'] },
      'medium',
    );
    expect(r.effectiveLevel).toBe('low');
  });
});

describe('translateEffort — 全部缺省（model 不支持 effort）', () => {
  it('完全空 mapping → 任何 level 返回 []，不 warn', () => {
    const r = translateEffort({}, 'max');
    expect(r.flags).toEqual([]);
    expect(r.fellBack).toBe(false);
    expect(r.warning).toBeUndefined();
  });

  it('全部字段 = [] 静默兼容（haiku 风格）', () => {
    const r = translateEffort(
      { none: [], low: [], medium: [], high: [], max: [] },
      'high',
    );
    expect(r.flags).toEqual([]);
    expect(r.fellBack).toBe(false);
  });
});
