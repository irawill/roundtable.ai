/**
 * 敏感字段 redact_patterns 替换工具。
 *
 * 来自 §security-privacy "敏感输入与持久化控制" + tasks.md §20.5.7。
 *
 * 调用方：阶段 6 的 RunsIo.writeMeta 之前用本工具替换 raw_question / enhanced_question /
 * agent answer 中匹配 redact_patterns 的片段。
 *
 * 已在 src/persistence/meta.ts 的 buildRedactor 中实装；本文件作为 re-export + 便利封装。
 */

export { buildRedactor } from '../persistence/meta.js';

/**
 * 错误日志格式化工具（来自 §security-privacy "敏感输入与持久化控制" + tasks.md §20.5.9）。
 *
 * 错误日志 / stderr 输出 MUST NOT 含完整 prompt 内容；仅 run_id + 错误类别 + model 名。
 */
export function formatErrorLog(args: {
  run_id?: string;
  adapter?: string;
  category: string;
  /** 任何含 prompt 的 detail 都 MUST NOT 传入 */
  detail?: string;
}): string {
  const parts: string[] = [];
  if (args.run_id !== undefined) parts.push(`[run_id=${args.run_id}]`);
  if (args.adapter !== undefined) parts.push(`adapter=${args.adapter}`);
  parts.push(`error=${args.category}`);
  if (args.detail !== undefined) parts.push(`detail=${args.detail}`);
  return parts.join(' ');
}
