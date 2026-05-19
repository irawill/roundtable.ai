import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';

/**
 * adapters.mjs 信任模型。
 *
 * 来自 §security-privacy "自定义 adapter 信任模型" + tasks.md §20.5.4。
 *
 * 核心约定：adapters.mjs 是任意本地 Node 代码执行；必须经过用户显式信任：
 * 1. 加载前在 stderr / TUI 一次性显式提示（"adapters.mjs 是任意 Node 代码..."）
 * 2. 首次加载 / 文件 mtime 变化时再次提示
 * 3. 用户按 Y 确认后 → 写 prefs.yaml.security.adapters_mjs_trusted_mtime
 * 4. CLI flag --no-adapters-mjs 跳过加载
 * 5. 文件权限 group/other 任一位可写 → 拒绝加载 + warn（防止其他用户篡改）
 *
 * 本模块仅产出**判定函数**与**信任状态变更建议**；具体 UI prompt 交互与持久化由上层
 * （阶段 6 持久化层、阶段 7 wizard）落地。
 */

export type TrustDecision =
  /** 已信任（mtime 匹配 trusted_mtime），可直接加载 */
  | { kind: 'trusted'; mtime: number }
  /** 文件不存在，无需加载（不算错误） */
  | { kind: 'absent' }
  /** 文件权限不安全（other 可写） */
  | { kind: 'unsafe_permissions'; mode: number; warning: string }
  /** 首次出现 / mtime 变化，需要用户确认 */
  | { kind: 'needs_confirmation'; mtime: number; reason: 'first_load' | 'mtime_changed' }
  /** stat 失败（罕见，I/O 错误等） */
  | { kind: 'stat_error'; error: string };

export interface EvaluateTrustArgs {
  /** adapters.mjs 绝对路径 */
  path: string;
  /** 当前 prefs.yaml.security.adapters_mjs_trusted_mtime（null 表示从未信任过） */
  currentTrustedMtime: number | null;
}

/**
 * 评估 adapters.mjs 当前的信任状态。
 *
 * 不读文件内容，仅 stat：
 * - 文件不存在 → absent
 * - other 位可写（包括 022 以上的危险权限）→ unsafe_permissions
 * - mtime == trusted_mtime → trusted
 * - mtime != trusted_mtime（含 trusted_mtime=null 的首次情形） → needs_confirmation
 */
export function evaluateAdaptersMjsTrust(args: EvaluateTrustArgs): TrustDecision {
  if (!existsSync(args.path)) {
    return { kind: 'absent' };
  }

  let stat;
  try {
    stat = statSync(args.path);
  } catch (err) {
    return { kind: 'stat_error', error: (err as Error).message };
  }

  // Windows 上 mode 位语义与 POSIX 不同，跳过权限检查（v1 不在 Windows 自动加载自定义 adapter）
  if (platform() !== 'win32') {
    // 权限校验：拒绝 other / group 可写（即 0022 位被设置）
    // mode 取低 9 位即 rwxrwxrwx
    const mode = stat.mode & 0o777;
    const otherWrite = (mode & 0o002) !== 0;
    const groupWrite = (mode & 0o020) !== 0;
    if (otherWrite || groupWrite) {
      return {
        kind: 'unsafe_permissions',
        mode,
        warning: `adapters.mjs 权限 ${mode.toString(8).padStart(4, '0')} 不安全（其他用户可写），请 chmod 600`,
      };
    }
  }

  const mtime = Math.floor(stat.mtimeMs);
  if (args.currentTrustedMtime === null) {
    return { kind: 'needs_confirmation', mtime, reason: 'first_load' };
  }
  if (mtime === args.currentTrustedMtime) {
    return { kind: 'trusted', mtime };
  }
  return { kind: 'needs_confirmation', mtime, reason: 'mtime_changed' };
}

/** 信任提示文案（一次性，每次需 confirmation 时展示）。 */
export const ADAPTERS_MJS_TRUST_PROMPT =
  'adapters.mjs 是任意 Node 代码，将以你的用户权限执行。仅加载你信任的文件。继续？(y/N)';
