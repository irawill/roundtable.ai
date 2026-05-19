import { describe, expect, it } from 'vitest';
import { extractJson } from '../../../src/adapters/runtime/json-extract.js';

describe('extractJson — pure_json', () => {
  it('整段是 JSON', () => {
    const r = extractJson('{"a":1}', { mode: 'pure_json' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ a: 1 });
  });

  it('前后含空白', () => {
    const r = extractJson('  {"a":1}\n', { mode: 'pure_json' });
    expect(r.ok).toBe(true);
  });

  it('空 stdout', () => {
    const r = extractJson('', { mode: 'pure_json' });
    expect(r.ok).toBe(false);
  });

  it('非法 JSON 报错', () => {
    const r = extractJson('not json', { mode: 'pure_json' });
    expect(r.ok).toBe(false);
  });
});

describe('extractJson — code_fence', () => {
  it('识别 ```json ... ``` 块', () => {
    const r = extractJson('一些文本\n```json\n{"a":1}\n```\n更多文本', { mode: 'code_fence' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ a: 1 });
  });

  it('识别无 lang tag 的 ``` 块', () => {
    const r = extractJson('```\n{"a":2}\n```', { mode: 'code_fence' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ a: 2 });
  });

  it('无 fence 块时报错', () => {
    const r = extractJson('plain text', { mode: 'code_fence' });
    expect(r.ok).toBe(false);
  });
});

describe('extractJson — json_extract（regex）', () => {
  it('regex capture group 1 抠出 JSON', () => {
    const r = extractJson('hello {"a":1} bye', {
      mode: 'json_extract',
      jsonRegex: '(\\{.*\\})',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ a: 1 });
  });

  it('未提供 jsonRegex 时报错', () => {
    const r = extractJson('{"a":1}', { mode: 'json_extract' });
    expect(r.ok).toBe(false);
  });

  it('非法正则报错', () => {
    const r = extractJson('any', { mode: 'json_extract', jsonRegex: '[' });
    expect(r.ok).toBe(false);
  });

  it('regex 未命中时报错', () => {
    const r = extractJson('no json here', {
      mode: 'json_extract',
      jsonRegex: '(\\{.*\\})',
    });
    expect(r.ok).toBe(false);
  });
});

describe('extractJson — stream_json (NDJSON)', () => {
  it('从 stream-json 末尾的 result 字段提取 + 二次解析 escaped JSON 字符串', () => {
    const stdout =
      '{"type":"system","subtype":"init"}\n' +
      '{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]}}\n' +
      '{"type":"result","subtype":"success","result":"{\\"answer\\":\\"hi\\",\\"key_claims\\":[]}","usage":{"input_tokens":10,"output_tokens":5}}';
    const r = extractJson(stdout, { mode: 'stream_json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // Claude stream-json 的 result 是 escaped JSON 字符串，extractor 二次 JSON.parse 还原为对象
      expect(typeof r.result.parsed).toBe('object');
      expect(r.result.parsed).toEqual({ answer: 'hi', key_claims: [] });
      expect(r.result.streamUsage).toEqual({
        input_tokens: 10,
        output_tokens: 5,
      });
    }
  });

  it('result 字段是纯文本（非 JSON）→ 保留为字符串', () => {
    const stdout =
      '{"type":"result","subtype":"success","result":"just plain text answer","usage":{"input_tokens":1,"output_tokens":1}}';
    const r = extractJson(stdout, { mode: 'stream_json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.parsed).toBe('just plain text answer');
    }
  });

  it('容错跳过非 JSON 行', () => {
    const stdout = 'progress: working...\n{"type":"result","result":"final","usage":{"input_tokens":1,"output_tokens":1}}';
    const r = extractJson(stdout, { mode: 'stream_json' });
    expect(r.ok).toBe(true);
  });

  it('空 stdout 报错', () => {
    const r = extractJson('', { mode: 'stream_json' });
    expect(r.ok).toBe(false);
  });

  it('全部非 JSON 行报错', () => {
    const r = extractJson('garbage\nmore garbage\n', { mode: 'stream_json' });
    expect(r.ok).toBe(false);
  });
});

describe('extractJson — stream_json (Codex NDJSON 形态)', () => {
  it('回扫识别 item.completed.item.text 字段 + 二次解析 JSON 字符串', () => {
    const stdout =
      '{"type":"thread.started","thread_id":"abc"}\n' +
      '{"type":"turn.started"}\n' +
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"answer\\":\\"hi\\"}"}}\n' +
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":50,"output_tokens":20}}';
    const r = extractJson(stdout, { mode: 'stream_json' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.parsed).toEqual({ answer: 'hi' });
      expect(r.result.streamUsage).toEqual({
        input_tokens: 100,
        cached_input_tokens: 50,
        output_tokens: 20,
      });
    }
  });
});

describe('extractJson — pure_json + pureJsonField (Gemini 形态)', () => {
  it('从顶层字段提取 agent 回复 + 二次解析嵌套 JSON 字符串', () => {
    const stdout = JSON.stringify({
      response: '{"answer":"hello","key_claims":[]}',
      stats: { tokens: { input: 10, total: 12 } },
    });
    const r = extractJson(stdout, { mode: 'pure_json', pureJsonField: 'response' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ answer: 'hello', key_claims: [] });
  });

  it('pureJsonField 不存在时报错', () => {
    const stdout = JSON.stringify({ other: 'x' });
    const r = extractJson(stdout, { mode: 'pure_json', pureJsonField: 'response' });
    expect(r.ok).toBe(false);
  });

  it('字段是纯文本（非 JSON）→ 保留为字符串', () => {
    const stdout = JSON.stringify({ response: 'plain text answer' });
    const r = extractJson(stdout, { mode: 'pure_json', pureJsonField: 'response' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toBe('plain text answer');
  });

  it('不配 pureJsonField 时 pure_json 行为不变（向后兼容）', () => {
    const stdout = '{"a":1}';
    const r = extractJson(stdout, { mode: 'pure_json' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ a: 1 });
  });
});

describe('extractJson — pure_json + pureJsonField + 代码围栏剥离', () => {
  it('agent 把 JSON 包在 ```json ... ``` 里也能解析（Gemini 实测）', () => {
    const stdout = JSON.stringify({
      response: '```json\n{\n  "answer": "hi"\n}\n```',
    });
    const r = extractJson(stdout, { mode: 'pure_json', pureJsonField: 'response' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ answer: 'hi' });
  });

  it('包在 ``` ... ``` (无 lang) 里也能解析', () => {
    const stdout = JSON.stringify({ response: '```\n{"answer":"hi"}\n```' });
    const r = extractJson(stdout, { mode: 'pure_json', pureJsonField: 'response' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.parsed).toEqual({ answer: 'hi' });
  });
});
