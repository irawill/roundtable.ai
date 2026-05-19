import { existsSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/**
 * Command Alias 三步检测（来自 §command-alias "可选 `rt` 短别名" Requirement）：
 *
 *   1. PATH 扫描：遍历 $PATH 各目录 stat 同名文件
 *   2. rc 文件 grep：读 shell 对应 rc 文件，匹配 alias <name>= / function <name>
 *   3. marker 优先：rc 文件含我们的 marker 时，认为是 roundtable.ai 自己设的（不算占用）
 *
 * 关键约定：**不依赖 subprocess which / command -v**——因为 shell alias / function
 * 不在 PATH 中（它们是 shell 内部状态）。当用户的 ~/.zshrc 已有 alias rt='/some/tool' 时，
 * which rt 在非交互式 subprocess 中看不到，但本检测仍能正确判定 rt 被占用。
 *
 * 本模块只做**检测**，返回结构化状态供 wizard / config CLI 使用；
 * 写入与 unset 在阶段 7 alias write / unset 模块落地。
 */

/** 我们的 marker 注释，用于区分"roundtable.ai 自己设的"vs"用户其他工具占用"。 */
export const MARKER_SHORT = '# rtai short alias (managed by roundtable.ai)';
export const MARKER_PRIMARY_FALLBACK = '# rtai primary alias fallback (managed by roundtable.ai)';
/** 旧版 marker（兼容用，新写入按 kind 分类）：视为短别名 marker。 */
export const MARKER_LEGACY_SHORT = '# rt alias (managed by roundtable.ai)';

/** 三种占用状态。 */
export type OccupancyStatus =
  /** 完全未占用（PATH 无该 binary、rc 无 alias/function 定义、无 marker） */
  | { kind: 'free' }
  /** PATH 中有同名 binary（非 roundtable.ai 安装路径） */
  | { kind: 'occupied_by_path'; path: string }
  /** rc 文件中有非-marker 的 alias / function 定义 */
  | { kind: 'occupied_by_rc'; rcFile: string; line: string }
  /** rc 中仅含 roundtable.ai marker（说明我们之前设过，进 alias check 流程） */
  | { kind: 'managed_by_us'; rcFile: string; markerKind: 'short' | 'primary_fallback' };

export interface DetectOccupancyInput {
  /** 待检测的命令名（如 "rt" / "rtai" / "rta"） */
  name: string;
  /** $PATH 字符串；缺省取 process.env.PATH */
  pathEnv?: string | undefined;
  /** rc 文件路径；null 表示该 shell 不可写 rc（如 unknown / windows）→ 仅做 PATH 检测 */
  rcFile: string | null;
  /** 路径 stat fn（测试可注入） */
  stat?: (p: string) => boolean;
  /** rc 文件读取 fn（测试可注入） */
  readRc?: (p: string) => string | undefined;
}

/**
 * 三步检测占用状态。
 *
 * 顺序：(a) PATH 扫描 → (b) rc 读 → (c) 综合判定。
 *
 * 注意优先级：
 * - 即使 PATH 有 binary，若 rc 文件仅含 marker 也算我们自己的（因为 marker 行写入时
 *   target alias 指向的就是这个 binary） → 实际上 PATH 命中是 npm 投放的 rtai 本身的情形，
 *   仍判 managed_by_us；但简化逻辑：PATH 命中即视为外部占用，让上层 check 自行决定是否冲突。
 * - 优先返回 occupied_by_path（更强信号），再 rc 中含非 marker 定义返回 occupied_by_rc，
 *   最后看是否有 marker。
 */
export function detectOccupancy(input: DetectOccupancyInput): OccupancyStatus {
  const stat = input.stat ?? defaultStat;
  const readRc = input.readRc ?? defaultReadRc;
  const pathEnv = input.pathEnv ?? process.env.PATH ?? '';

  // 步骤 1：PATH 扫描
  const pathHit = scanPath(input.name, pathEnv, stat);
  if (pathHit !== null) {
    return { kind: 'occupied_by_path', path: pathHit };
  }

  // 步骤 2：rc 文件读取（shell 不可写 rc 时跳过）
  if (input.rcFile === null) {
    return { kind: 'free' };
  }
  const rcContent = readRc(input.rcFile);
  if (rcContent === undefined) {
    // rc 文件不存在 → 未占用（shell 启动时 rc 也不会执行任何 alias）
    return { kind: 'free' };
  }

  // 步骤 3：grep alias / function 定义 + marker 检测
  const aliasRe = new RegExp(`^[ \\t]*alias[ \\t]+${escapeName(input.name)}=`, 'm');
  const functionRe = new RegExp(`^[ \\t]*function[ \\t]+${escapeName(input.name)}[ \\t({]`, 'm');
  // fish 用 alias <name> '<cmd>'（无 =），稍后再加 fish 支持；先覆盖 zsh / bash
  const fishAliasRe = new RegExp(`^[ \\t]*alias[ \\t]+${escapeName(input.name)}[ \\t]+`, 'm');

  const lines = rcContent.split('\n');

  // 找所有匹配定义行 + 它前一行
  const matches: { idx: number; line: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (aliasRe.test(line) || functionRe.test(line) || fishAliasRe.test(line)) {
      matches.push({ idx: i, line });
    }
  }

  if (matches.length === 0) {
    return { kind: 'free' };
  }

  // 检查每条匹配是否前一行是我们的 marker
  let foundMarkerKind: 'short' | 'primary_fallback' | null = null;
  let foundOccupier: { line: string } | null = null;
  for (const m of matches) {
    const prev = m.idx > 0 ? (lines[m.idx - 1] ?? '').trim() : '';
    if (prev === MARKER_SHORT || prev === MARKER_LEGACY_SHORT) {
      foundMarkerKind = 'short';
      continue;
    }
    if (prev === MARKER_PRIMARY_FALLBACK) {
      foundMarkerKind = 'primary_fallback';
      continue;
    }
    // 非 marker 定义 → 占用
    foundOccupier = { line: m.line };
    break;
  }

  if (foundOccupier !== null) {
    return { kind: 'occupied_by_rc', rcFile: input.rcFile, line: foundOccupier.line };
  }
  if (foundMarkerKind !== null) {
    return { kind: 'managed_by_us', rcFile: input.rcFile, markerKind: foundMarkerKind };
  }
  return { kind: 'free' };
}

/** 在 $PATH 中查找 binary；命中返回绝对路径，未命中返回 null。 */
function scanPath(name: string, pathEnv: string, stat: (p: string) => boolean): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === '') continue;
    const full = join(dir, name);
    if (stat(full)) return full;
  }
  return null;
}

function defaultStat(p: string): boolean {
  try {
    const s = statSync(p);
    return s.isFile() || s.isSymbolicLink();
  } catch {
    return false;
  }
}

function defaultReadRc(p: string): string | undefined {
  if (!existsSync(p)) return undefined;
  return readFileSync(p, 'utf8');
}

/** 转义正则元字符，避免 name 含 . / + 等被当作正则。 */
function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
