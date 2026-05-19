import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../src/adapters/runtime/json-extract.js';
import { extractUsage } from '../../../src/adapters/runtime/usage.js';
import { translateEffort } from '../../../src/adapters/runtime/effort.js';
import { createClaudeAdapter } from '../../../src/adapters/builtins/claude.js';

/**
 * ClaudeAdapter fixture 单测。
 *
 * 仅做"解析层"回归——不实际 spawn claude CLI（sandbox 无真实 CLI）。
 * 把 fixture 文件当成 spawnAndCollect 的 stdout 输入，跑 extractJson + extractUsage
 * 验证解析逻辑正确。
 */
const fixturePath = join(
  __dirname,
  '..',
  '..',
  'adapters',
  'claude',
  'fixtures',
  '2026-05-14',
  'round1.stream-json.txt',
);

describe('ClaudeAdapter — fixture 解析', () => {
  const stdout = readFileSync(fixturePath, 'utf8');

  it('stream_json 提取出 result + streamUsage', () => {
    const r = extractJson(stdout, { mode: 'stream_json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.parsed).toBeDefined();
      expect(r.result.streamUsage).toEqual({
        input_tokens: 120,
        output_tokens: 48,
        cache_read_input_tokens: 80,
        reasoning_tokens: 256,
      });
    }
  });

  it('extractUsage 把 streamUsage 转 Usage 对象', () => {
    const r = extractJson(stdout, { mode: 'stream_json' });
    if (!r.ok) throw new Error('extract failed');
    const usage = extractUsage({
      mode: 'stream_json',
      streamUsage: r.result.streamUsage,
    });
    expect(usage).toEqual({
      input_tokens: 120,
      output_tokens: 48,
      cached_input_tokens: 80,
      reasoning_tokens: 256,
    });
  });
});

describe('ClaudeAdapter — 实例属性与 effort', () => {
  it('capabilities 含 web_search / code_understanding / code_execution / reasoning_effort', () => {
    const a = createClaudeAdapter();
    expect(a.capabilities).toContain('web_search');
    expect(a.capabilities).toContain('code_understanding');
    expect(a.capabilities).toContain('code_execution');
    expect(a.capabilities).toContain('reasoning_effort');
  });

  it('name = "claude"', () => {
    expect(createClaudeAdapter().name).toBe('claude');
  });

  it('effort=high 翻译为 --effort high', () => {
    const a = createClaudeAdapter();
    const mapping = (
      a as unknown as {
        spec: { effortMapping: Record<string, readonly string[]> };
      }
    ).spec.effortMapping;
    const r = translateEffort(mapping, 'high');
    expect(r.flags).toEqual(['--effort', 'high']);
  });

  it('roleSuitability.enhancer/executor 都是 high', () => {
    const a = createClaudeAdapter();
    expect(a.roleSuitability.enhancer).toBe('high');
    expect(a.roleSuitability.executor).toBe('high');
  });
});
