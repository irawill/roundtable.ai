import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../src/adapters/runtime/json-extract.js';
import { extractUsage } from '../../../src/adapters/runtime/usage.js';
import { createGeminiAdapter } from '../../../src/adapters/builtins/gemini.js';

const fixturePath = join(
  __dirname,
  '..',
  '..',
  'adapters',
  'gemini',
  'fixtures',
  '2026-05-14',
  'round1.json',
);

describe('GeminiAdapter — fixture 解析', () => {
  const stdout = readFileSync(fixturePath, 'utf8');

  it('pure_json 提取整个对象', () => {
    const r = extractJson(stdout, { mode: 'pure_json' });
    expect(r.ok).toBe(true);
  });

  it('usage 模式 = none → 返回 null（CLI 不暴露 usage）', () => {
    const r = extractJson(stdout, { mode: 'pure_json' });
    if (!r.ok) throw new Error('extract failed');
    const usage = extractUsage({
      mode: 'none',
      parsed: r.result.parsed,
    });
    expect(usage).toBeNull();
  });
});

describe('GeminiAdapter — 实例属性', () => {
  it('capabilities = [web_search, reasoning_effort]', () => {
    const a = createGeminiAdapter();
    expect(a.capabilities).toEqual(['web_search', 'reasoning_effort']);
  });

  it('effort 通过 -m 切档（none/low → flash, medium/high/max → pro）', () => {
    const a = createGeminiAdapter();
    const mapping = (
      a as unknown as {
        spec: { effortMapping: Record<string, readonly string[]> };
      }
    ).spec.effortMapping;
    expect(mapping.low).toEqual(['-m', 'gemini-2.5-flash']);
    expect(mapping.high).toEqual(['-m', 'gemini-2.5-pro']);
    expect(mapping.max).toEqual(['-m', 'gemini-2.5-pro']);
  });

  it('usage.mode = none（CLI 不暴露 usage_metadata）', () => {
    const a = createGeminiAdapter();
    const spec = (a as unknown as { spec: { usage?: { mode: string } } }).spec;
    expect(spec.usage?.mode).toBe('none');
  });

  it('name = "gemini"', () => {
    expect(createGeminiAdapter().name).toBe('gemini');
  });
});
