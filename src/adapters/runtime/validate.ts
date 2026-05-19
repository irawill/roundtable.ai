import type { z } from 'zod';

/**
 * Zod 校验 + 1 次重试逻辑。
 *
 * 来自 §agent-adapter "Adapter 调用 5 步骤" 步骤 4 + §roundtable-orchestrator "错误处理矩阵"：
 *
 *   schema.parse(jsonObj)；失败重试 1 次（带 parse error 反馈给 prompt）；仍失败 throw
 *
 * 重试 prompt 注入约定：原 prompt + "---" 分隔小节 + parse 错误描述 +
 * "请修正 JSON 输出后重新作答（仅输出修正后的 JSON）"。
 *
 * 本模块负责"校验 + 拼接重试 prompt"；不负责实际 spawn / extract（那是上层的事）。
 */

/** 校验结果。 */
export type ValidateOutcome<T> =
  | { ok: true; data: T; retried: boolean }
  | { ok: false; finalError: string; retried: boolean };

export interface ValidateWithRetryArgs<T extends z.ZodTypeAny> {
  schema: T;
  /** 第一次解析得到的 JSON（来自 extractJson） */
  firstParsed: unknown;
  /** 第二次调用 adapter 拿到的 JSON（仅在第一次失败时调用方提供） */
  callSecond: (retryPromptSuffix: string) => Promise<unknown>;
}

/**
 * 校验 + 必要时重试。
 *
 * 流程：
 * 1. schema.safeParse(firstParsed)；成功 → 直接返回 data，retried=false
 * 2. 失败 → 构造 retry prompt suffix → callSecond(suffix) → 第二次 safeParse
 * 3. 第二次成功 → 返回 data，retried=true
 * 4. 第二次仍失败 → 返回 finalError，retried=true（上层标 ERRORED）
 */
export async function validateWithRetry<T extends z.ZodTypeAny>(
  args: ValidateWithRetryArgs<T>,
): Promise<ValidateOutcome<z.infer<T>>> {
  const first = args.schema.safeParse(args.firstParsed);
  if (first.success) {
    return { ok: true, data: first.data, retried: false };
  }

  // 构造重试 prompt suffix
  const retrySuffix = buildRetryPromptSuffix(formatZodIssues(first.error));

  let secondParsed: unknown;
  try {
    secondParsed = await args.callSecond(retrySuffix);
  } catch (err) {
    return {
      ok: false,
      finalError: `重试调用 adapter 失败：${(err as Error).message}`,
      retried: true,
    };
  }

  const second = args.schema.safeParse(secondParsed);
  if (second.success) {
    return { ok: true, data: second.data, retried: true };
  }

  return {
    ok: false,
    finalError: `重试后仍未通过 schema 校验：\n${formatZodIssues(second.error)}`,
    retried: true,
  };
}

/**
 * 构造重试 prompt 后缀。
 *
 * 显式说明上次输出不符合 schema、具体问题、请修正。
 * 使用 --- 分隔便于 agent 在 prompt 中识别小节。
 */
export function buildRetryPromptSuffix(parseErrorText: string): string {
  return [
    '',
    '---',
    '',
    '上次输出不符合所需 JSON schema。问题：',
    parseErrorText,
    '',
    '请修正后**仅输出修正后的 JSON**（不要其他解释文本）。',
  ].join('\n');
}

/** 把 Zod 错误格式化为多行字符串。 */
export function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((iss) => {
      const path = iss.path.map((s) => String(s)).join('.');
      return `- ${path === '' ? '(root)' : path}: ${iss.message}`;
    })
    .join('\n');
}
