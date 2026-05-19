import type { Usage } from '../../shared/adapter.js';

/**
 * Usage 提取器。
 *
 * 来自 §token-usage-tracking + tasks.md §4.5。
 *
 * 三模式（与 models.yaml.<name>.usage.mode 对应）：
 * - `stream_json`：从 extractJson 的 streamUsage 字段（Claude stream-json）取出
 * - `regex`：用正则从 stdout / stderr 抠 input/output token 数（需 capture group 1=input, 2=output）
 * - `json_path`：从 parsed JSON 取 usage 对象（如 "usage" / "metadata.usage"）
 *
 * 任何 mode 失败 / CLI 不暴露 usage → 返回 null（**不**用本地 tokenizer 估算，
 * 详见 §token-usage-tracking "不做本地 tokenizer 估算" + 跨阶段约束 #14）。
 */

export interface UsageExtractInput {
  /** usage 配置（来自 models.yaml.<name>.usage） */
  mode: 'stream_json' | 'regex' | 'json_path' | 'none' | undefined;
  /** stdout 全文（regex 模式用） */
  stdout?: string;
  /** stderr 全文（部分 CLI 把 usage 写到 stderr） */
  stderr?: string;
  /** extractJson 解析后 parsed 对象（json_path 模式用） */
  parsed?: unknown;
  /** extractJson 的 streamUsage（stream_json 模式用） */
  streamUsage?: unknown;
  /** json_path 模式必填：如 "usage" / "metadata.usage" */
  jsonPath?: string;
  /** regex 模式必填：正则字符串，期望 (\d+)...(\d+) 形式捕获 input / output */
  regex?: string;
}

/**
 * 提取 usage。返回 null 表示 CLI 不暴露或抠取失败（**不**抛错，调用方流程不阻塞）。
 */
export function extractUsage(input: UsageExtractInput): Usage | null {
  if (input.mode === undefined || input.mode === 'none') return null;

  switch (input.mode) {
    case 'stream_json':
      return fromStreamUsage(input.streamUsage);
    case 'regex':
      return fromRegex(input.stdout, input.stderr, input.regex);
    case 'json_path':
      return fromJsonPath(input.parsed, input.jsonPath);
  }
}

/** 从 streamUsage 对象（claude stream-json 末尾的 usage 字段）提取。 */
function fromStreamUsage(streamUsage: unknown): Usage | null {
  if (!isRecord(streamUsage)) return null;
  return readUsageShape(streamUsage);
}

/** 用 regex 从 stdout / stderr 抠 input / output token。 */
function fromRegex(
  stdout: string | undefined,
  stderr: string | undefined,
  regexStr: string | undefined,
): Usage | null {
  if (!regexStr) return null;
  let re: RegExp;
  try {
    re = new RegExp(regexStr, 's');
  } catch {
    return null;
  }
  const combined = (stdout ?? '') + '\n' + (stderr ?? '');
  const m = combined.match(re);
  if (!m) return null;

  const input = parseIntOrNull(m[1]);
  const output = parseIntOrNull(m[2]);
  if (input === null || output === null) return null;

  return { input_tokens: input, output_tokens: output };
}

/** 从 parsed JSON 按 jsonPath 取 usage 对象。 */
function fromJsonPath(parsed: unknown, jsonPath: string | undefined): Usage | null {
  if (!jsonPath) return null;
  const obj = getByPath(parsed, jsonPath);
  if (!isRecord(obj)) return null;
  return readUsageShape(obj);
}

/**
 * 从 record 形态的 usage 对象按已知字段名读 token 数。
 *
 * 支持的别名（兼容 Anthropic / OpenAI / Google 各自字段命名）：
 * - input：input_tokens / prompt_tokens / total_input_tokens
 * - output：output_tokens / completion_tokens / total_output_tokens
 * - cached：cache_read_input_tokens / cached_input_tokens / cached_tokens
 * - reasoning：reasoning_tokens / thinking_tokens
 */
function readUsageShape(o: Record<string, unknown>): Usage | null {
  const input = pickInt(o, ['input_tokens', 'prompt_tokens', 'total_input_tokens']);
  const output = pickInt(o, ['output_tokens', 'completion_tokens', 'total_output_tokens']);
  if (input === null || output === null) return null;

  const usage: Usage = { input_tokens: input, output_tokens: output };
  const cached = pickInt(o, [
    'cache_read_input_tokens',
    'cached_input_tokens',
    'cached_tokens',
  ]);
  if (cached !== null) usage.cached_input_tokens = cached;

  const reasoning = pickInt(o, ['reasoning_tokens', 'thinking_tokens']);
  if (reasoning !== null) usage.reasoning_tokens = reasoning;

  // 透传 provisional 标记（仅 stream_json 流式 usage 包可能含 provisional=true）
  if (o.provisional === true) usage.provisional = true;

  return usage;
}

function pickInt(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0) {
      return v;
    }
  }
  return null;
}

function parseIntOrNull(s: string | undefined): number | null {
  if (s === undefined) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 按 "a.b.c" 形式取嵌套字段。 */
function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (!isRecord(cur)) return undefined;
    cur = cur[seg];
  }
  return cur;
}
