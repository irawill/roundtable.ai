import { spawnAndCollect } from './spawn.js';
import type { AuthState } from '../../shared/adapter.js';

/**
 * Auth 检测器。
 *
 * 来自 §agent-adapter "Auth 状态检测" + tasks.md §4.6。
 *
 * 双轨原则（当 CLI 支持多种认证方式时）：
 * - check_command 是**权威信号**
 * - check_env 仅作 fast path：env 已设视为 "ok"（不再跑 check_command）；
 *   env 未设回退跑 check_command
 *
 * 例：Codex 同时支持 ChatGPT account login 与 OPENAI_API_KEY；env 未设但用户 codex login
 * 已登录时，仅靠 env 检测会误判 missing；本逻辑回退跑 codex login status 才能正确返回 ok。
 *
 * stderr_expired_patterns 是**被动识别**——当 invoke 失败、stderr 含 401 / unauthorized 等模式时
 * 用 matchExpiredPattern 判定 expired，由调用方触发 re-auth 流程（详见 §agent-adapter 运行中
 * auth 恢复）。
 */

export interface DetectAuthArgs {
  /** auth.check_command（如 "claude doctor" / "codex login status"） */
  checkCommand?: string | undefined;
  /** auth.check_env（如 "OPENAI_API_KEY"） */
  checkEnv?: string | undefined;
  /** 超时（毫秒）；默认 10s（auth 命令应当很快） */
  timeoutMs?: number;
  /** 环境变量；默认 process.env */
  env?: NodeJS.ProcessEnv;
}

/**
 * 主动检测 auth 状态。
 *
 * 流程：
 * 1. 若 checkEnv 已设且非空 → 返回 ok（fast path 命中）
 * 2. 若有 checkCommand → 跑 command；exit code 0 视为 ok；非 0 视为 missing
 * 3. checkCommand 与 checkEnv 都未配置 → 返回 unknown（让 invoke 实际跑后看 stderr）
 * 4. spawn 报错（binary 不存在等）→ 返回 unknown（让上层 binaryAvailable 单独判定）
 */
export async function detectAuthState(args: DetectAuthArgs): Promise<AuthState> {
  const env = args.env ?? process.env;

  // 步骤 1：env fast path
  if (args.checkEnv && env[args.checkEnv] !== undefined && env[args.checkEnv] !== '') {
    return 'ok';
  }

  // 步骤 2：check_command
  if (args.checkCommand) {
    const [cmd, ...cmdArgs] = args.checkCommand.split(/\s+/).filter((s) => s !== '');
    if (cmd === undefined) return 'unknown';
    try {
      const result = await spawnAndCollect({
        command: cmd,
        args: cmdArgs,
        prompt: '',
        transport: 'stdin',
        timeoutMs: args.timeoutMs ?? 10_000,
        env,
      });
      if (result.exitCode === 0) return 'ok';
      // 非 0：常见情形 "未登录"。区分 missing vs expired 需要看 stderr pattern，
      // 但 §agent-adapter "Auth 状态检测" 把 expired 主要交给被动识别
      // （stderr_expired_patterns），主动检测层返回 missing。
      return 'missing';
    } catch {
      // spawn 失败（如 binary 不存在）→ unknown；让 binaryAvailable 单独判定
      return 'unknown';
    }
  }

  // 步骤 3：完全未配置
  return 'unknown';
}

/**
 * 被动识别：用 stderr_expired_patterns 判断本次 invoke 报错是否 auth 过期。
 *
 * 匹配任一 pattern（不区分大小写）→ 视为 expired。
 */
export function matchExpiredPattern(stderr: string, patterns: readonly string[]): boolean {
  for (const pat of patterns) {
    let re: RegExp;
    try {
      re = new RegExp(pat, 'i');
    } catch {
      continue;
    }
    if (re.test(stderr)) return true;
  }
  return false;
}
