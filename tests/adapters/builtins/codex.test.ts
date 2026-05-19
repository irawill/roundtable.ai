import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../src/adapters/runtime/json-extract.js';
import { extractUsage } from '../../../src/adapters/runtime/usage.js';
import { createCodexAdapter } from '../../../src/adapters/builtins/codex.js';

const fixturePath = join(
  __dirname,
  '..',
  '..',
  'adapters',
  'codex',
  'fixtures',
  '2026-05-14',
  'round1.json',
);

describe('CodexAdapter — fixture 解析', () => {
  const stdout = readFileSync(fixturePath, 'utf8');

  it('pure_json 提取整个对象', () => {
    const r = extractJson(stdout, { mode: 'pure_json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.result.parsed as Record<string, unknown>).answer).toBeDefined();
    }
  });

  it('usage 通过 json_path "usage" 提取', () => {
    const r = extractJson(stdout, { mode: 'pure_json' });
    if (!r.ok) throw new Error('extract failed');
    const usage = extractUsage({
      mode: 'json_path',
      parsed: r.result.parsed,
      jsonPath: 'usage',
    });
    expect(usage?.input_tokens).toBe(132);
    expect(usage?.output_tokens).toBe(56);
    expect(usage?.reasoning_tokens).toBe(128);
  });
});

describe('CodexAdapter — 实例属性', () => {
  it('capabilities = [web_search, code_understanding, reasoning_effort]', () => {
    const a = createCodexAdapter();
    expect(a.capabilities).toContain('web_search');
    expect(a.capabilities).toContain('code_understanding');
    expect(a.capabilities).toContain('reasoning_effort');
  });

  it('双轨 auth：check_env=OPENAI_API_KEY, check_command=codex login status', () => {
    const a = createCodexAdapter();
    const spec = (
      a as unknown as {
        spec: { authCheckEnv?: string; authCheckCommand?: string };
      }
    ).spec;
    expect(spec.authCheckEnv).toBe('OPENAI_API_KEY');
    expect(spec.authCheckCommand).toBe('codex login status');
  });

  it('effort 翻译为 -c model_reasoning_effort=<level>', () => {
    const a = createCodexAdapter();
    const mapping = (
      a as unknown as {
        spec: { effortMapping: Record<string, readonly string[]> };
      }
    ).spec.effortMapping;
    expect(mapping.high).toEqual(['-c', 'model_reasoning_effort=high']);
  });

  it('name = "codex"', () => {
    expect(createCodexAdapter().name).toBe('codex');
  });
});
