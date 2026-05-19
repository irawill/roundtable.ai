import { describe, expect, it } from 'vitest';
import { checkActive } from '../../src/orchestrator/active-check.js';

describe('checkActive — multi_agent 路径', () => {
  it('>= 2 active → continue', () => {
    const r = checkActive({ active: ['claude', 'codex'], path: 'multi_agent' });
    expect(r.action).toBe('continue');
    if (r.action === 'continue') expect(r.activeCount).toBe(2);
  });

  it('1 active → abort + 建议禁用失败 agent', () => {
    const r = checkActive({ active: ['claude'], path: 'multi_agent' });
    expect(r.action).toBe('abort');
    if (r.action === 'abort') {
      expect(r.activeCount).toBe(1);
      expect(r.reason).toContain('剩余 active');
      expect(r.instructions).toContain('rtai config models disable');
      expect(r.instructions).toContain('claude');
    }
  });

  it('0 active → abort + 排查指引', () => {
    const r = checkActive({ active: [], path: 'multi_agent' });
    expect(r.action).toBe('abort');
    if (r.action === 'abort') {
      expect(r.reason).toContain('所有 agent');
      expect(r.instructions).toContain('rtai config models check');
    }
  });
});

describe('checkActive — single_agent 路径', () => {
  it('1 active → continue', () => {
    const r = checkActive({ active: ['claude'], path: 'single_agent' });
    expect(r.action).toBe('continue');
  });

  it('0 active → abort', () => {
    const r = checkActive({ active: [], path: 'single_agent' });
    expect(r.action).toBe('abort');
  });
});

describe('checkActive — 默认 path multi_agent', () => {
  it('未传 path → 视为 multi_agent', () => {
    const r = checkActive({ active: ['claude'] });
    expect(r.action).toBe('abort');
  });
});
