import { existsSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/**
 * binary 可用性检测。
 *
 * 来自 §agent-adapter "统一 Adapter 接口" + tasks.md §2.4：
 * - binaryAvailable() 仅检查 binary 是否在 $PATH 或 cli_path 中存在
 * - MUST NOT 触发任何鉴权检查（auth 状态另行 detectAuthState）
 *
 * 双信号分离的目的（详见 §agent-adapter "核心约定（auth 与 binary 分离）"）：
 * - binary 缺失是不可恢复的（用户没装这个 CLI）
 * - auth 问题是可恢复的（用户去另一个终端 login 一次即可）
 * - 两者归一会导致 auth 问题被误当 binary 问题，绕过 re-auth 流程
 */

export interface BinaryAvailableArgs {
  /** 命令名（如 "claude" / "codex"）或绝对路径（来自 models.yaml.<name>.cli_path） */
  command: string;
  /** $PATH 字符串；缺省取 process.env.PATH */
  pathEnv?: string | undefined;
}

/**
 * 检查 binary 是否存在。
 *
 * - command 为绝对路径 → 直接 stat
 * - command 为相对名 → 遍历 $PATH 各目录 stat
 * - 文件存在且可被 stat 视为可用（**不**执行）
 */
export function binaryAvailable(args: BinaryAvailableArgs): boolean {
  if (isAbsolute(args.command)) {
    return canStat(args.command);
  }

  const pathEnv = args.pathEnv ?? process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue;
    if (canStat(join(dir, args.command))) return true;
  }
  return false;
}

function canStat(p: string): boolean {
  if (!existsSync(p)) return false;
  try {
    const s = statSync(p);
    return s.isFile() || s.isSymbolicLink();
  } catch {
    return false;
  }
}
