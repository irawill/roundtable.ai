import { spawnAndCollect } from './spawn.js';

/**
 * CLI 版本探测 + 升级 warn。
 *
 * 来自 §agent-adapter "CLI flag 示例不构成长期契约（version probe + golden fixture）"
 * + tasks.md §5.5 / §5.7。
 *
 * 每个内置 adapter MUST 实现 version()：
 * - 调 `<cli> --version`，返回版本字符串
 * - 持久化到 meta.json.adapter_versions[name]（阶段 6 落地）
 * - 启动时与上次成功 run 对比 → 不同则 warn 提示用户检查 effort_mapping / output 解析是否仍有效
 */

export interface ProbeVersionArgs {
  /** binary 名或绝对路径 */
  command: string;
  /** 版本 flag（如 "--version" / "-V"） */
  versionFlag?: string;
  /** 超时（毫秒）；默认 5s（version 命令应当很快） */
  timeoutMs?: number;
}

export interface ProbeVersionResult {
  /** 提取出的版本字符串；探测失败时为 null */
  version: string | null;
  /** 原始 stdout（debug 用） */
  rawStdout: string;
}

/**
 * 调 `<cli> <flag>` 并提取版本字符串。
 *
 * 提取策略：
 * - 优先取第一个匹配 X.Y.Z / X.Y / X 的字串（与 semver 兼容）
 * - 失败则取 stdout 第一行（trim）
 * - 全空 → null
 */
export async function probeVersion(args: ProbeVersionArgs): Promise<ProbeVersionResult> {
  const flag = args.versionFlag ?? '--version';
  let result;
  try {
    result = await spawnAndCollect({
      command: args.command,
      args: [flag],
      prompt: '',
      transport: 'stdin',
      timeoutMs: args.timeoutMs ?? 5_000,
    });
  } catch {
    return { version: null, rawStdout: '' };
  }

  if (result.exitCode !== 0) {
    return { version: null, rawStdout: result.stdout };
  }

  return { version: parseVersion(result.stdout), rawStdout: result.stdout };
}

/**
 * 从 stdout 文本提取版本字符串。
 *
 * 优先匹配 semver 形式（X.Y.Z 或 X.Y.Z-beta.1 等），fallback 到 X.Y / X / 第一行。
 */
export function parseVersion(stdout: string): string | null {
  const trimmed = stdout.trim();
  if (trimmed === '') return null;

  // semver-like：X.Y.Z 或 X.Y.Z-prerelease
  const semverRe = /\b(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\b/;
  const m = trimmed.match(semverRe);
  if (m !== null) return m[1] ?? null;

  // fallback：X.Y
  const twoPartRe = /\b(\d+\.\d+)\b/;
  const m2 = trimmed.match(twoPartRe);
  if (m2 !== null) return m2[1] ?? null;

  // 最后兜底：第一行（去掉常见前缀如 "v1"）
  const firstLine = trimmed.split('\n')[0]!.trim();
  return firstLine === '' ? null : firstLine;
}

/**
 * 比较本次 probe 出的版本与上次成功 run 的版本，决定是否 warn。
 *
 * 字符串严格相等才视为"无变化"；前缀 v / 大小写差异都视为变化（保守，宁可多 warn）。
 *
 * @returns 若需要 warn，返回 warn 文案；否则 null
 */
export function compareVersion(args: {
  current: string | null;
  lastKnown: string | null;
  adapterName: string;
}): string | null {
  if (args.current === null || args.lastKnown === null) return null; // 无法对比
  if (args.current === args.lastKnown) return null;
  return (
    `${args.adapterName} CLI 版本从 ${args.lastKnown} 升到 ${args.current}；` +
    `若 invoke 失败请运行 \`rtai config models check ${args.adapterName}\` 确认 effort_mapping / output 解析仍有效`
  );
}
