import { describe, expect, it } from 'vitest';
import { compareVersion, parseVersion } from '../../../src/adapters/runtime/version.js';

describe('parseVersion', () => {
  it('semver X.Y.Z', () => {
    expect(parseVersion('claude version 1.2.3')).toBe('1.2.3');
  });

  it('semver 带 prerelease', () => {
    expect(parseVersion('foo 2.0.0-beta.1')).toBe('2.0.0-beta.1');
  });

  it('两段 X.Y', () => {
    expect(parseVersion('Codex 0.5')).toBe('0.5');
  });

  it('空 stdout → null', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('   ')).toBeNull();
  });

  it('无版本数字 → 第一行 trimmed', () => {
    expect(parseVersion('unknown-build\nmore')).toBe('unknown-build');
  });
});

describe('compareVersion', () => {
  it('相同版本 → null（不 warn）', () => {
    expect(
      compareVersion({ current: '1.2.3', lastKnown: '1.2.3', adapterName: 'claude' }),
    ).toBeNull();
  });

  it('不同版本 → warn 文案含 adapter 名 + 旧新版本', () => {
    const w = compareVersion({ current: '1.3.0', lastKnown: '1.2.3', adapterName: 'claude' });
    expect(w).toContain('claude');
    expect(w).toContain('1.2.3');
    expect(w).toContain('1.3.0');
    expect(w).toContain('rtai config models check claude');
  });

  it('current=null（probe 失败）→ null', () => {
    expect(
      compareVersion({ current: null, lastKnown: '1.2.3', adapterName: 'claude' }),
    ).toBeNull();
  });

  it('lastKnown=null（首次 run）→ null', () => {
    expect(
      compareVersion({ current: '1.2.3', lastKnown: null, adapterName: 'claude' }),
    ).toBeNull();
  });
});
