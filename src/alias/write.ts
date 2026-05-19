import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  MARKER_LEGACY_SHORT,
  MARKER_PRIMARY_FALLBACK,
  MARKER_SHORT,
} from './detect.js';
import type { ShellKind } from './shell.js';

/**
 * Alias 写入 / unset rc 文件。
 *
 * 来自 §command-alias "marker 注释支持精准清理（按 kind 分行）" + "rtai config alias 子命令"
 * + "Shell 自动识别 + 选 rc 文件" + tasks.md §19.5 §19.8 §19.9。
 *
 * 写入约定：
 * - 绝对路径（**不**用 `alias rt='rtai'`，后者会被 PATH 占用者拦截）
 * - 前一行 marker 注释（按 kind 区分 short / primary_fallback）
 * - 多次写入前**先**按 marker 移除旧条目（避免重复行）
 *
 * 各 shell 语法：
 * - zsh / bash：`alias rt='/abs/path'`
 * - fish：`alias rt '/abs/path'`（**无** = 号）
 * - nushell：`alias rt = "/abs/path"`（用 = 但值用双引号）
 */

export type AliasKind = 'short' | 'primary_fallback';

export interface WriteAliasArgs {
  rcFile: string;
  shell: ShellKind;
  /** alias 名（如 "rt" / "rta"） */
  name: string;
  /** alias 指向的绝对路径（如 /opt/homebrew/bin/rtai） */
  target: string;
  /** marker 类型 */
  kind: AliasKind;
}

/**
 * 写入 alias（已存在则**先**按 marker 移除旧条目再写入）。
 *
 * @returns rc 文件路径（便于持久化到 prefs.cli.*_written_to）
 */
export function writeAliasToRc(args: WriteAliasArgs): string {
  // 先按 marker 移除旧条目（避免重复）
  unsetAliasFromRc({ rcFile: args.rcFile, kind: args.kind });

  const marker = markerFor(args.kind);
  const aliasLine = renderAliasLine(args.shell, args.name, args.target);
  const block = `\n${marker}\n${aliasLine}\n`;

  // appendFile 自动创建文件
  if (!existsSync(args.rcFile)) {
    writeFileSync(args.rcFile, '', 'utf8');
  }
  appendFileSync(args.rcFile, block, 'utf8');
  return args.rcFile;
}

/**
 * 按 marker 精准移除 rc 文件中的 alias 行 + marker 行。
 *
 * 兼容旧版 legacy short marker（# rt alias (managed by roundtable.ai)）—— 仅在 kind=short 时识别清理。
 *
 * @returns 是否实际移除了行
 */
export function unsetAliasFromRc(args: { rcFile: string; kind: AliasKind }): boolean {
  if (!existsSync(args.rcFile)) return false;
  const content = readFileSync(args.rcFile, 'utf8');
  const lines = content.split('\n');

  const targetMarkers = new Set<string>();
  targetMarkers.add(markerFor(args.kind));
  if (args.kind === 'short') targetMarkers.add(MARKER_LEGACY_SHORT);

  const kept: string[] = [];
  let removedAny = false;
  let skipNext = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (skipNext) {
      // 跳过 marker 后紧跟的一行（alias / function 定义行）
      skipNext = false;
      removedAny = true;
      continue;
    }
    if (targetMarkers.has(line.trim())) {
      // 跳过 marker 行 + 下一行
      skipNext = true;
      removedAny = true;
      continue;
    }
    kept.push(line);
  }

  if (!removedAny) return false;

  // 移除产生的连续多空行（仅简单合并 3+ 空行为 2）
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n');
  writeFileSync(args.rcFile, cleaned, 'utf8');
  return true;
}

function markerFor(kind: AliasKind): string {
  return kind === 'short' ? MARKER_SHORT : MARKER_PRIMARY_FALLBACK;
}

/**
 * 按 shell 渲染 alias 行（不含 marker）。
 */
export function renderAliasLine(shell: ShellKind, name: string, target: string): string {
  switch (shell) {
    case 'zsh':
    case 'bash':
      return `alias ${name}='${target}'`;
    case 'fish':
      // fish: alias rt '/abs/path'（无 =；单引号包裹）
      return `alias ${name} '${target}'`;
    case 'nushell':
      // nushell: alias rt = "/abs/path"（双引号）
      return `alias ${name} = "${target}"`;
    case 'unknown':
    case 'windows':
      // 不可写入；返回最通用 bash 形式（仅 stdout 展示用）
      return `alias ${name}='${target}'`;
  }
}
