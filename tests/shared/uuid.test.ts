import { describe, expect, it } from 'vitest';
import { isValidUuidV4, uuidv4 } from '../../src/shared/uuid.js';

describe('uuidv4', () => {
  it('生成合法 v4 UUID', () => {
    const u = uuidv4();
    expect(isValidUuidV4(u)).toBe(true);
  });

  it('多次生成不重复', () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) set.add(uuidv4());
    expect(set.size).toBe(100);
  });
});

describe('isValidUuidV4', () => {
  it('接受合法 v4 UUID', () => {
    expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('拒绝非 UUID 字符串', () => {
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
    expect(isValidUuidV4('')).toBe(false);
    expect(isValidUuidV4('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('拒绝 v1 UUID（version 字段不是 4）', () => {
    expect(isValidUuidV4('550e8400-e29b-11d4-a716-446655440000')).toBe(false);
  });
});
