import { describe, expect, it } from 'vitest';
import { nowIso, toIso } from '../../src/shared/time.js';

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('nowIso', () => {
  it('返回 ISO 8601 格式（带毫秒 Z 后缀）', () => {
    expect(nowIso()).toMatch(ISO_8601_RE);
  });

  it('可被 Date 重新解析', () => {
    const s = nowIso();
    const d = new Date(s);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });
});

describe('toIso', () => {
  it('给定 Date 返回 ISO 8601', () => {
    const d = new Date('2026-05-14T10:00:00.000Z');
    expect(toIso(d)).toBe('2026-05-14T10:00:00.000Z');
  });
});
