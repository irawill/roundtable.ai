import { describe, expect, it, vi } from 'vitest';
import { invokeSingleAgent } from '../../src/orchestrator/single-agent.js';
import { BUILTIN_SCENES } from '../../src/config/defaults/builtin-scenes.js';
import type { Adapter, AdapterInvokeArgs, AdapterResult } from '../../src/shared/adapter.js';

function mockAdapter(behavior: 'ok' | 'fail_then_ok' | 'fail_twice'): Adapter {
  let callCount = 0;
  return {
    name: 'mock',
    capabilities: [],
    roleSuitability: { enhancer: 'medium', executor: 'medium' },
    binaryAvailable: vi.fn(async () => true),
    version: vi.fn(async () => '1.0.0'),
    detectAuthState: vi.fn(async () => 'ok'),
    authInstructions: vi.fn(() => 'login'),
    invoke: vi.fn(async (_args: AdapterInvokeArgs): Promise<AdapterResult> => {
      callCount++;
      if (behavior === 'ok') {
        return {
          rawStdout: '',
          parsed: { answer: 'hello' },
          usage: { input_tokens: 10, output_tokens: 5 },
          durationMs: 100,
        };
      }
      if (behavior === 'fail_then_ok' && callCount === 1) {
        throw new Error('first call fails');
      }
      if (behavior === 'fail_then_ok' && callCount === 2) {
        return {
          rawStdout: '',
          parsed: { answer: 'hello on retry' },
          usage: null,
          durationMs: 100,
        };
      }
      // fail_twice 或第二次失败
      throw new Error(`call ${callCount} fails`);
    }),
  };
}

describe('invokeSingleAgent — direct + downgraded 共享', () => {
  it('第一次 ok → 返回 success', async () => {
    const adapter = mockAdapter('ok');
    const r = await invokeSingleAgent({
      question: 'q',
      adapter,
      agentName: 'mock',
      scene: BUILTIN_SCENES.scenes.general!,
      resolvedOutputLanguage: 'en',
      effort: 'medium',
      timeoutMs: 5000,
      kind: 'direct',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.answer).toBe('hello');
      expect(adapter.invoke).toHaveBeenCalledTimes(1);
    }
  });

  it('第一次失败，第二次 ok → 返回 success（重试一次）', async () => {
    const adapter = mockAdapter('fail_then_ok');
    const r = await invokeSingleAgent({
      question: 'q',
      adapter,
      agentName: 'mock',
      scene: BUILTIN_SCENES.scenes.general!,
      resolvedOutputLanguage: 'en',
      effort: 'medium',
      timeoutMs: 5000,
      kind: 'downgraded',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output.answer).toBe('hello on retry');
      expect(adapter.invoke).toHaveBeenCalledTimes(2);
    }
  });

  it('两次都失败 → ok=false', async () => {
    const adapter = mockAdapter('fail_twice');
    const r = await invokeSingleAgent({
      question: 'q',
      adapter,
      agentName: 'mock',
      scene: BUILTIN_SCENES.scenes.general!,
      resolvedOutputLanguage: 'en',
      effort: 'medium',
      timeoutMs: 5000,
      kind: 'direct',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('单 agent');
      expect(r.error).toContain('重试');
    }
    expect(adapter.invoke).toHaveBeenCalledTimes(2);
  });
});
