/**
 * JSON 提取工具。
 *
 * 来自 §agent-adapter "Adapter 调用 5 步骤" + tasks.md §4.2。
 *
 * 4 种 output.mode：
 * - `pure_json`：进程纯 JSON 输出，直接 JSON.parse stdout
 * - `code_fence`：识别 ```json ... ``` 块（取第一个匹配）
 * - `json_extract`：用 regex 抠 JSON 子串（用户自加 adapter 常用）
 * - `stream_json`：解析 Claude --output-format stream-json 的多行 JSON 流，提取
 *   最终 message 与 usage（Claude CLI 用 NDJSON：每行一个 JSON 对象）
 *
 * 所有方法失败时返回 `{ ok: false, error: ... }`；调用方决定是否走重试。
 */

export type ExtractMode = 'pure_json' | 'code_fence' | 'json_extract' | 'stream_json';

export interface ExtractResult {
  /** 解析出的 JSON 对象（未经 schema 校验） */
  parsed: unknown;
  /**
   * 仅 stream_json：streaming usage 包（如果有）。其他 mode 为 undefined。
   * 由具体 adapter 在 usage 提取阶段使用。
   */
  streamUsage?: unknown;
}

export type ExtractOutcome =
  | { ok: true; result: ExtractResult }
  | { ok: false; error: string };

export interface ExtractOptions {
  mode: ExtractMode;
  /** json_extract 模式必填：抠 JSON 子串的正则 */
  jsonRegex?: string | undefined;
  /**
   * pure_json 模式可选：进程输出顶层 JSON 后从该字段提取 agent 真实回复（嵌套 JSON 字符串需二次解析）。
   * 例：Gemini CLI `-o json` 输出 `{"response":"...", "stats":{...}}`，设 `pureJsonField: "response"` 取 response。
   */
  pureJsonField?: string | undefined;
}

/**
 * 主入口：按 mode 提取 JSON。
 */
export function extractJson(stdout: string, options: ExtractOptions): ExtractOutcome {
  switch (options.mode) {
    case 'pure_json':
      return extractPureJson(stdout, options.pureJsonField);
    case 'code_fence':
      return extractCodeFence(stdout);
    case 'json_extract':
      return extractByRegex(stdout, options.jsonRegex);
    case 'stream_json':
      return extractStreamJson(stdout);
  }
}

function extractPureJson(stdout: string, pureJsonField: string | undefined): ExtractOutcome {
  const trimmed = stdout.trim();
  if (trimmed === '') return { ok: false, error: 'pure_json: stdout 为空' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: `pure_json 解析失败：${(e as Error).message}` };
  }
  // pureJsonField 配置：从顶层 JSON 取指定字段（agent 真实回复嵌套于此），若值是 JSON 字符串则二次解析。
  // 容错：agent 常把 JSON 包在 ```json ... ``` 代码块里（Gemini 实测），自动剥围栏后再解析。
  if (pureJsonField !== undefined && pureJsonField !== '') {
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: `pure_json: 配置了 pureJsonField="${pureJsonField}" 但顶层 JSON 不是对象` };
    }
    const inner = (parsed as Record<string, unknown>)[pureJsonField];
    if (inner === undefined) {
      return { ok: false, error: `pure_json: 顶层 JSON 缺少字段 "${pureJsonField}"` };
    }
    if (typeof inner === 'string') {
      // 先剥可能的 markdown 代码围栏
      const fenceMatch = inner.match(CODE_FENCE_RE);
      const candidate = (fenceMatch && fenceMatch[1] !== undefined ? fenceMatch[1] : inner).trim();
      if (candidate.startsWith('{') || candidate.startsWith('[')) {
        try {
          parsed = JSON.parse(candidate);
        } catch {
          parsed = inner;
        }
      } else {
        parsed = inner;
      }
    } else {
      parsed = inner;
    }
  }
  return { ok: true, result: { parsed } };
}

const CODE_FENCE_RE = /```(?:json)?\s*\n([\s\S]*?)\n```/i;

function extractCodeFence(stdout: string): ExtractOutcome {
  const m = stdout.match(CODE_FENCE_RE);
  if (!m || m[1] === undefined) {
    return { ok: false, error: 'code_fence: 未找到 ```json ... ``` 块' };
  }
  try {
    return { ok: true, result: { parsed: JSON.parse(m[1].trim()) } };
  } catch (e) {
    return { ok: false, error: `code_fence 解析失败：${(e as Error).message}` };
  }
}

function extractByRegex(stdout: string, regexStr: string | undefined): ExtractOutcome {
  if (!regexStr) {
    return { ok: false, error: 'json_extract: 必须提供 jsonRegex' };
  }
  let re: RegExp;
  try {
    re = new RegExp(regexStr, 's');
  } catch (e) {
    return { ok: false, error: `json_extract: 无效正则 "${regexStr}"：${(e as Error).message}` };
  }
  const m = stdout.match(re);
  if (!m) {
    return { ok: false, error: `json_extract: 正则未命中：${regexStr}` };
  }
  // 优先用 capture group 1，否则用整个 match
  const candidate = (m[1] ?? m[0]).trim();
  try {
    return { ok: true, result: { parsed: JSON.parse(candidate) } };
  } catch (e) {
    return { ok: false, error: `json_extract 解析失败：${(e as Error).message}` };
  }
}

/**
 * 解析 stream-json（NDJSON）格式。
 *
 * Claude CLI --output-format stream-json 输出多行 JSON，每行一个对象。
 * 典型对象类型（基于公开文档）：
 * - `{ type: "system", ... }`
 * - `{ type: "assistant", message: { content: [...] } }`
 * - `{ type: "result", subtype: "success", result: "...", usage: {...} }`
 *
 * 本函数：
 * - 跳过非 JSON 行（容错）
 * - 优先取最后一个含 `result` 的对象作为最终消息
 * - 把含 `usage` 的对象的 usage 字段挂到 streamUsage 上
 * - parsed 字段返回最终的"result"对象（让调用方按 schema 校验 result 字段）
 *
 * 容错：若找不到 result 对象，返回最后一个有效 JSON 对象。
 */
function extractStreamJson(stdout: string): ExtractOutcome {
  const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) {
    return { ok: false, error: 'stream_json: stdout 为空' };
  }

  const objects: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj === 'object' && obj !== null) {
        objects.push(obj as Record<string, unknown>);
      }
    } catch {
      // 跳过非 JSON 行（如 progress 文本）
    }
  }

  if (objects.length === 0) {
    return { ok: false, error: 'stream_json: 未解析出任何 JSON 对象' };
  }

  // 兼容 Claude（`result` 字段）与 Codex（`item.completed.item.text` 字段）两种 stream-json 形态
  let parsed: unknown;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj === undefined) continue;
    // Claude：{"type":"result","result":"...","usage":{...}}
    if (obj.result !== undefined) {
      parsed = obj.result;
      break;
    }
    // Codex：{"type":"item.completed","item":{"id":"...","type":"agent_message","text":"..."}}
    const item = obj.item;
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).text === 'string'
    ) {
      parsed = (item as Record<string, unknown>).text;
      break;
    }
  }
  // fallback 到最后一个对象
  if (parsed === undefined) parsed = objects[objects.length - 1];

  // 提取 streamUsage：找最后一个含 usage 的对象
  let streamUsage: unknown;
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (obj !== undefined && obj.usage !== undefined) {
      streamUsage = obj.usage;
      break;
    }
  }

  // Claude stream-json 实测：`result` 字段是**字符串**（serialized JSON，如 '{"answer":"4"}'），
  // Codex 的 `item.text` 同样是 serialized JSON 字符串。
  // 需要二次 JSON.parse。若 parse 失败（如纯文本"4"），保留原字符串供上层 schema 决定如何处理。
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // 保留原字符串
      }
    }
  }

  const result: ExtractResult = { parsed };
  if (streamUsage !== undefined) result.streamUsage = streamUsage;
  return { ok: true, result };
}
