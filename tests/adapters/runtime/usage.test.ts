import { describe, expect, it } from 'vitest';
import { extractUsage } from '../../../src/adapters/runtime/usage.js';

describe('extractUsage — none / undefined', () => {
  it('mode 未设 → null', () => {
    expect(extractUsage({ mode: undefined })).toBeNull();
  });

  it('mode = none → null', () => {
    expect(extractUsage({ mode: 'none' })).toBeNull();
  });
});

describe('extractUsage — stream_json', () => {
  it('Anthropic 字段名（input_tokens / output_tokens / cache_read_input_tokens / reasoning_tokens）', () => {
    const u = extractUsage({
      mode: 'stream_json',
      streamUsage: {
        input_tokens: 120,
        output_tokens: 48,
        cache_read_input_tokens: 80,
        reasoning_tokens: 256,
      },
    });
    expect(u).toEqual({
      input_tokens: 120,
      output_tokens: 48,
      cached_input_tokens: 80,
      reasoning_tokens: 256,
    });
  });

  it('streamUsage 缺失 → null', () => {
    expect(extractUsage({ mode: 'stream_json' })).toBeNull();
  });

  it('streamUsage 不是 record → null', () => {
    expect(extractUsage({ mode: 'stream_json', streamUsage: 'string' })).toBeNull();
  });

  it('input / output 缺失 → null', () => {
    expect(extractUsage({ mode: 'stream_json', streamUsage: { foo: 'bar' } })).toBeNull();
  });

  it('provisional 标记透传', () => {
    const u = extractUsage({
      mode: 'stream_json',
      streamUsage: { input_tokens: 10, output_tokens: 5, provisional: true },
    });
    expect(u?.provisional).toBe(true);
  });
});

describe('extractUsage — regex', () => {
  it('从 stdout regex 抠 capture group 1=input, 2=output', () => {
    const u = extractUsage({
      mode: 'regex',
      stdout: 'tokens: input=120 output=48',
      regex: 'input=(\\d+) output=(\\d+)',
    });
    expect(u).toEqual({ input_tokens: 120, output_tokens: 48 });
  });

  it('从 stderr 抠也可以', () => {
    const u = extractUsage({
      mode: 'regex',
      stderr: 'usage: 100 / 50',
      regex: '(\\d+) / (\\d+)',
    });
    expect(u).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it('regex 未命中 → null', () => {
    const u = extractUsage({
      mode: 'regex',
      stdout: 'no numbers',
      regex: '(\\d+) / (\\d+)',
    });
    expect(u).toBeNull();
  });

  it('regex 非法 → null', () => {
    const u = extractUsage({
      mode: 'regex',
      stdout: 'hi',
      regex: '[',
    });
    expect(u).toBeNull();
  });
});

describe('extractUsage — json_path', () => {
  it('顶层 usage 字段', () => {
    const u = extractUsage({
      mode: 'json_path',
      parsed: { result: 'hi', usage: { input_tokens: 10, output_tokens: 5 } },
      jsonPath: 'usage',
    });
    expect(u).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it('嵌套 usage 字段（metadata.usage）', () => {
    const u = extractUsage({
      mode: 'json_path',
      parsed: { metadata: { usage: { input_tokens: 1, output_tokens: 2 } } },
      jsonPath: 'metadata.usage',
    });
    expect(u).toEqual({ input_tokens: 1, output_tokens: 2 });
  });

  it('OpenAI 别名（prompt_tokens / completion_tokens）', () => {
    const u = extractUsage({
      mode: 'json_path',
      parsed: { usage: { prompt_tokens: 100, completion_tokens: 50 } },
      jsonPath: 'usage',
    });
    expect(u).toEqual({ input_tokens: 100, output_tokens: 50 });
  });

  it('路径不存在 → null', () => {
    const u = extractUsage({
      mode: 'json_path',
      parsed: { foo: 'bar' },
      jsonPath: 'usage.deep',
    });
    expect(u).toBeNull();
  });

  it('jsonPath 未提供 → null', () => {
    expect(
      extractUsage({ mode: 'json_path', parsed: { usage: { input_tokens: 1, output_tokens: 1 } } }),
    ).toBeNull();
  });
});
