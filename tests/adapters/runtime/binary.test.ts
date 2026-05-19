import { describe, expect, it } from 'vitest';
import { binaryAvailable } from '../../../src/adapters/runtime/binary.js';

describe('binaryAvailable', () => {
  it('绝对路径存在 → true（node 自身）', () => {
    expect(binaryAvailable({ command: process.execPath })).toBe(true);
  });

  it('绝对路径不存在 → false', () => {
    expect(binaryAvailable({ command: '/non/existent/binary' })).toBe(false);
  });

  it('PATH 中存在的命令（node）→ true', () => {
    // 假设 node 在 PATH 中（vitest 跑得起说明在）
    expect(binaryAvailable({ command: 'node' })).toBe(true);
  });

  it('PATH 中不存在 → false', () => {
    expect(binaryAvailable({ command: 'definitely-not-a-real-binary-xyz' })).toBe(false);
  });

  it('支持注入 PATH', () => {
    expect(
      binaryAvailable({ command: 'node', pathEnv: '/non/existent' }),
    ).toBe(false);
  });

  it('空 PATH → false（除绝对路径外）', () => {
    expect(binaryAvailable({ command: 'node', pathEnv: '' })).toBe(false);
  });
});
