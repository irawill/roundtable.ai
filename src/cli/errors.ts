/**
 * 错误处理统一出口。
 *
 * 来自 §language-support "错误日志永远英文" + §security-privacy "敏感输入与持久化控制"
 * + tasks.md §20.5 + 阶段 7 错误处理统一出口。
 *
 * 核心约定：
 * - stack trace / debug 输出**永远英文**（面向开发者）
 * - 用户面向错误用 resolved_ui_language 翻译包（v0.1.0 简化：英文 + 关键术语保留原文）
 * - 错误日志仅 [run_id=...] adapter=... error=... 不含 prompt
 * - 未捕获异常 catch + 友好提示 + exit code 非 0
 */

import { formatErrorLog } from '../security/redact.js';

/** 标准化的 CLI 退出码。 */
export const ExitCode = {
  Success: 0,
  GenericError: 1,
  UsageError: 2, // 命令行参数 / flag 错误
  ConfigError: 3, // 配置文件不存在 / 校验失败
  RuntimeError: 4, // 运行时（adapter / orchestrator）错误
  Aborted: 130, // 用户 Ctrl-C（SIGINT 标准 exit code = 128 + 2）
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * CLI 错误：携带 exit code + 用户可见 message。
 *
 * 在 main() 顶层 catch；message 写到 stderr，按 code 退出。
 */
export class CliError extends Error {
  constructor(
    message: string,
    public readonly code: ExitCode = ExitCode.GenericError,
    public readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * 顶层错误处理：把错误写到 stderr 后 exit。
 *
 * - CliError → 友好 message + hint
 * - Error → stack trace（英文）
 * - 其他 → stringify
 *
 * @param err  未捕获的错误
 * @param writeStderr  注入便于测试（默认 process.stderr.write）
 * @param exit  注入便于测试（默认 process.exit）
 */
export function handleTopLevelError(
  err: unknown,
  writeStderr: (s: string) => void = (s) => process.stderr.write(s),
  exit: (code: number) => never = (code) => process.exit(code) as never,
): never {
  if (err instanceof CliError) {
    writeStderr(`✗ ${err.message}\n`);
    if (err.hint !== undefined) writeStderr(`  hint: ${err.hint}\n`);
    return exit(err.code);
  }
  if (err instanceof Error) {
    writeStderr(`✗ ${err.message}\n`);
    // stack trace 永远英文（来自 §language-support "错误日志永远英文"）
    if (err.stack !== undefined && process.env.RTAI_DEBUG === '1') {
      writeStderr(err.stack + '\n');
    }
    return exit(ExitCode.GenericError);
  }
  writeStderr(`✗ unknown error: ${String(err)}\n`);
  return exit(ExitCode.GenericError);
}

/**
 * 记录到 stderr 的错误日志（不含 prompt 内容）。
 *
 * 调用方在 adapter / orchestrator 中 catch 后调用，确保符合
 * §security-privacy "敏感输入与持久化控制" 的约束。
 */
export function logRuntimeError(args: {
  run_id?: string;
  adapter?: string;
  category: string;
  detail?: string;
  writeStderr?: (s: string) => void;
}): void {
  const stderr = args.writeStderr ?? ((s: string) => process.stderr.write(s));
  stderr(formatErrorLog(args) + '\n');
}
