import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  buildRetryPromptSuffix,
  formatZodIssues,
  validateWithRetry,
} from '../../../src/adapters/runtime/validate.js';

const Schema = z.object({ answer: z.string(), n: z.number() });

describe('validateWithRetry', () => {
  it('第一次解析成功 → 不重试', async () => {
    const callSecond = vi.fn();
    const r = await validateWithRetry({
      schema: Schema,
      firstParsed: { answer: 'hi', n: 1 },
      callSecond,
    });
    expect(r.ok).toBe(true);
    expect(r.retried).toBe(false);
    expect(callSecond).not.toHaveBeenCalled();
  });

  it('第一次失败 → 重试一次 → 第二次成功', async () => {
    const callSecond = vi.fn(async () => ({ answer: 'fixed', n: 2 }));
    const r = await validateWithRetry({
      schema: Schema,
      firstParsed: { answer: 'hi' }, // 缺 n
      callSecond,
    });
    expect(r.ok).toBe(true);
    expect(r.retried).toBe(true);
    expect(callSecond).toHaveBeenCalledTimes(1);
    // 调用 callSecond 时收到的 retry suffix 应含 parse error
    const arg = callSecond.mock.calls[0]![0];
    expect(arg).toContain('上次输出不符合所需 JSON schema');
    expect(arg).toContain('n');
  });

  it('第一次失败 → 重试 → 仍失败 → finalError', async () => {
    const callSecond = vi.fn(async () => ({ answer: 'still bad' })); // 仍缺 n
    const r = await validateWithRetry({
      schema: Schema,
      firstParsed: {},
      callSecond,
    });
    expect(r.ok).toBe(false);
    expect(r.retried).toBe(true);
    if (!r.ok) {
      expect(r.finalError).toContain('重试后仍未通过 schema 校验');
    }
  });

  it('callSecond throw → finalError 含 adapter 错误', async () => {
    const callSecond = vi.fn(async () => {
      throw new Error('adapter timeout');
    });
    const r = await validateWithRetry({
      schema: Schema,
      firstParsed: {},
      callSecond,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.finalError).toContain('adapter timeout');
    }
  });
});

describe('buildRetryPromptSuffix / formatZodIssues', () => {
  it('suffix 含三个关键元素：分隔符 / 错误描述 / 修正要求', () => {
    const s = buildRetryPromptSuffix('- answer: required');
    expect(s).toContain('---');
    expect(s).toContain('answer: required');
    expect(s).toContain('仅输出修正后的 JSON');
  });

  it('formatZodIssues：root 路径用 (root) 标记', () => {
    const r = Schema.safeParse('not an object');
    expect(r.success).toBe(false);
    if (!r.success) {
      const formatted = formatZodIssues(r.error);
      expect(formatted).toContain('(root)');
    }
  });

  it('formatZodIssues：嵌套路径用 . 连接', () => {
    const Nested = z.object({ deep: z.object({ x: z.number() }) });
    const r = Nested.safeParse({ deep: { x: 'oops' } });
    expect(r.success).toBe(false);
    if (!r.success) {
      const formatted = formatZodIssues(r.error);
      expect(formatted).toContain('deep.x');
    }
  });
});
