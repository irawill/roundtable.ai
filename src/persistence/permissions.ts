import { existsSync, mkdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';

/**
 * 持久化层权限工具。
 *
 * 来自 §security-privacy "落盘文件权限最小化" + tasks.md §20.5.3。
 *
 * 约束（POSIX 系统）：
 * - 目录权限 0700（owner rwx，group/other 无权限）
 * - 文件权限 0600（owner rw，group/other 无权限）
 * - 启动时校验已有路径权限；group/other 任一位可读 / 可写 → warn
 *
 * Windows 跳过（v1 主用户体验在 macOS / Linux；Windows 权限模型不同）。
 */

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 安全创建目录（递归，0700）；已存在不报错。 */
export function ensureSecureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: DIR_MODE });
}

/**
 * 校验已有路径权限：group/other 任一位可读 / 可写 → 返回 warning 文案；否则 null。
 *
 * Windows 平台 / 路径不存在 → null（不 warn）。
 */
export function checkPermissions(path: string): string | null {
  if (platform() === 'win32') return null;
  if (!existsSync(path)) return null;

  let mode: number;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    return null;
  }

  // group/other 位有任何 r/w/x → warn
  const groupOtherBits = mode & 0o077;
  if (groupOtherBits !== 0) {
    return `路径 "${path}" 权限 ${mode.toString(8).padStart(4, '0')} 偏松（含 group/other 位），建议 \`chmod 700 "${path}"\``;
  }
  return null;
}

/** writeFile 的安全 mode（0600）。 */
export const SECURE_FILE_MODE = FILE_MODE;
export const SECURE_DIR_MODE = DIR_MODE;
