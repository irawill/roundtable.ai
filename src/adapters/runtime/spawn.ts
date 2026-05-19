import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * subprocess spawn 封装。
 *
 * 来自 §agent-adapter "Adapter 调用 5 步骤" + §security-privacy "prompt 传递避免 argv 泄露"
 * + §roundtable-orchestrator "默认 timeout"。
 *
 * 三档 prompt_transport：
 * - stdin（默认）：spawn 后 child.stdin.write(prompt) + end()；argv 不含 prompt
 * - tmpfile：mkdtemp 在 $TMPDIR 创建 0600 文件，写 prompt → 替换 argv 中的占位符
 *   （prompt_file_placeholder） → spawn 后 try/finally unlink（异常路径也清理）
 * - argv：直接放 argv 末尾；prompt 长度 > 4KB MUST 拒绝并 abort
 *
 * argv 上限来自 §security-privacy "prompt 传递避免 argv 泄露"：4KB（4096 字节）。
 */

export const ARGV_PROMPT_LIMIT_BYTES = 4096;

/** prompt 传递方式 */
export type PromptTransport = 'stdin' | 'tmpfile' | 'argv';

export interface SpawnArgs {
  /** binary 路径或 PATH 中的命令名 */
  command: string;
  /** argv（不含 binary 自身）。tmpfile 模式下 prompt_file_placeholder 字符串会被替换为临时文件路径 */
  args: readonly string[];
  /** prompt 字符串（按 transport 决定传递方式） */
  prompt: string;
  /** prompt 传递方式；默认 stdin */
  transport?: PromptTransport;
  /** 超时（毫秒）；超时后 SIGTERM，再 1s SIGKILL 兜底 */
  timeoutMs: number;
  /** 环境变量；默认继承 process.env */
  env?: NodeJS.ProcessEnv;
  /** tmpfile 模式下用于替换 args 中的占位符；默认 '{prompt_file}' */
  promptFilePlaceholder?: string;
}

export interface SpawnResult {
  /** subprocess exit code（信号杀死时为 null） */
  exitCode: number | null;
  /** subprocess 收到的信号（如 SIGTERM）；正常退出为 null */
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** 端到端耗时（毫秒） */
  durationMs: number;
  /** 是否因 timeout 被杀 */
  timedOut: boolean;
}

export class SpawnError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'SpawnError';
  }
}

/**
 * spawn + 收集输出。
 *
 * @throws SpawnError 如果 argv 模式 prompt > 4KB、tmpfile 创建失败、spawn 自身报错
 */
export async function spawnAndCollect(args: SpawnArgs): Promise<SpawnResult> {
  const transport: PromptTransport = args.transport ?? 'stdin';
  const start = Date.now();

  // argv 上限校验（来自 §security-privacy）
  if (transport === 'argv') {
    const byteLen = Buffer.byteLength(args.prompt, 'utf8');
    if (byteLen > ARGV_PROMPT_LIMIT_BYTES) {
      throw new SpawnError(
        `prompt 超出 argv 安全上限 ${ARGV_PROMPT_LIMIT_BYTES} 字节（实际 ${byteLen}）；请改用支持 stdin 的 CLI`,
      );
    }
  }

  // 准备 tmpfile（仅 tmpfile 模式）
  let tmpDir: string | null = null;
  let tmpFilePath: string | null = null;
  let finalArgs: string[] = [...args.args];

  if (transport === 'tmpfile') {
    try {
      tmpDir = await mkdtemp(join(tmpdir(), 'rtai-prompt-'));
      tmpFilePath = join(tmpDir, 'prompt');
      await writeFile(tmpFilePath, args.prompt, { encoding: 'utf8', mode: 0o600 });
    } catch (err) {
      // 清理已创建的 tmpDir
      if (tmpDir !== null) {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
      throw new SpawnError('创建临时 prompt 文件失败', err);
    }
    // 替换占位符
    const placeholder = args.promptFilePlaceholder ?? '{prompt_file}';
    finalArgs = finalArgs.map((a) => (a === placeholder ? tmpFilePath! : a));
  } else if (transport === 'argv') {
    finalArgs = [...finalArgs, args.prompt];
  }

  try {
    return await runChild({
      command: args.command,
      finalArgs,
      prompt: args.prompt,
      transport,
      timeoutMs: args.timeoutMs,
      env: args.env ?? process.env,
      start,
    });
  } finally {
    // try/finally 保证 tmpfile 清理（含异常路径）
    if (tmpDir !== null) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

interface RunChildArgs {
  command: string;
  finalArgs: string[];
  prompt: string;
  transport: PromptTransport;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  start: number;
}

function runChild(opts: RunChildArgs): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = nodeSpawn(opts.command, opts.finalArgs, {
        env: opts.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new SpawnError(`spawn ${opts.command} 失败`, err));
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // 子进程可能已退出
      }
      // 1s 后用 SIGKILL 兜底
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // 同上
        }
      }, 1000);
    }, opts.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(new SpawnError(`subprocess error: ${err.message}`, err));
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - opts.start,
        timedOut,
      });
    });

    // stdin pipe 传 prompt（仅 stdin 模式）
    if (opts.transport === 'stdin') {
      try {
        child.stdin.write(opts.prompt, 'utf8');
        child.stdin.end();
      } catch (err) {
        // 写 stdin 失败通常意味着子进程已退出；让 close 事件处理
        // eslint-disable-next-line no-console
        console.error('[spawn] stdin write failed:', err);
      }
    } else {
      // 非 stdin 模式仍需 end() 以避免子进程等输入
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
    }
  });
}
