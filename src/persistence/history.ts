import { readdirSync, rmSync, statSync } from 'node:fs';
import type { PrefsFile } from '../config/schemas/prefs.js';
import { matchesLangFilter } from '../lang/meta.js';
import { isValidUuidV4 } from '../shared/uuid.js';
import { formatTokenCount } from '../usage/summary-table.js';
import type { RunMeta } from './meta.js';
import type { RunsIo } from './runs.js';

/**
 * History 子命令核心逻辑。
 *
 * 来自 §persistence-history "rtai history 列表" / "rtai show 详情" / "rtai export 导出"
 * / "history 保留策略" + §token-usage-tracking "history 显示总 token" + tasks.md §17.5-§17.9 §15.6。
 *
 * Commander 包装在阶段 7 CLI 入口落地；本模块仅产出**纯函数 + 命令处理器**。
 */

export interface HistoryListItem {
  run_id: string;
  /** ISO 8601 started_at（用于排序） */
  startedAt: string;
  date: string; // 简短显示形式
  scene: string;
  rounds: number;
  totalTokens: number;
  question: string; // 截断后形态
  /** 原始 meta.json.language.resolved_output（用于 --lang 过滤） */
  resolvedOutputLang: string;
  /** root run 为 null；追问 run 为被追问的 run_id（来自 §followup-rounds） */
  parentRunId: string | null;
  /** root=0；追问 +1 累加（冗余字段） */
  followupDepth: number;
}

const QUESTION_TRUNCATE = 50;

/**
 * 列出所有已落盘的 run，按 started_at 倒序。
 *
 * @param filter  --scene / --lang 过滤
 */
export function listRuns(args: {
  runsIo: RunsIo;
  runsDir: string;
  filter?: { scene?: string; lang?: string };
}): HistoryListItem[] {
  const items: HistoryListItem[] = [];

  let entries: string[];
  try {
    entries = readdirSync(args.runsDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!isValidUuidV4(entry)) continue;
    const meta = args.runsIo.readMeta(entry);
    if (meta === null) continue;
    const m = meta as unknown as RunMeta;
    if (m.run_id !== entry) continue; // 损坏 / 不一致

    // 过滤
    if (args.filter?.scene !== undefined && m.scene !== args.filter.scene) continue;
    if (
      args.filter?.lang !== undefined &&
      !matchesLangFilter(args.filter.lang, m.language.resolved_output)
    ) {
      continue;
    }

    items.push({
      run_id: m.run_id,
      startedAt: m.started_at,
      date: m.started_at.split('T')[0] ?? m.started_at,
      scene: m.scene,
      rounds: m.rounds_completed,
      totalTokens: m.usage_totals.grand_total,
      question: truncateQuestion(m.raw_question),
      resolvedOutputLang: m.language.resolved_output,
      parentRunId: m.parent_run_id,
      followupDepth: m.followup_depth,
    });
  }

  items.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return items;
}

/**
 * 把 listRuns 结果渲染为 stdout 表格字符串。
 *
 * 列：UUID | Date | Scene | Rounds | Tokens | Question
 */
export function renderHistoryTable(items: readonly HistoryListItem[]): string {
  if (items.length === 0) return '(no runs found)';
  const lines: string[] = [];
  lines.push(
    'UUID                                  Date        Scene       Rounds  Tokens   Thread          Question',
  );
  lines.push('-'.repeat(110));
  for (const item of items) {
    const threadCol =
      item.parentRunId !== null
        ? `↳ ${item.parentRunId.slice(0, 8)} d=${item.followupDepth}`
        : '';
    lines.push(
      `${item.run_id}  ${pad(item.date, 10)}  ${pad(item.scene, 10)}  ${pad(String(item.rounds), 6)}  ${pad(formatTokenCount(item.totalTokens), 7)}  ${pad(threadCol, 14)}  ${item.question}`,
    );
  }
  return lines.join('\n');
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + ' '.repeat(width - s.length);
}

function truncateQuestion(q: string): string {
  const firstLine = q.split('\n')[0] ?? '';
  if (firstLine.length <= QUESTION_TRUNCATE) return firstLine;
  return Array.from(firstLine).slice(0, QUESTION_TRUNCATE).join('') + '…';
}

/**
 * rtai show <uuid>：返回 meta 摘要 + final.md 内容。
 *
 * --rounds 展开：额外列每轮每 agent 的 raw output（从 events.jsonl 抽取 agent_responded 事件）。
 */
export interface ShowRunArgs {
  runsIo: RunsIo;
  runId: string;
  withRounds?: boolean;
}

export interface ShowRunResult {
  meta: RunMeta;
  finalMd: string | null;
  /** 仅 withRounds=true 时填充 */
  rounds?: Array<{
    round: number;
    agent: string;
    rawOutput: string;
  }>;
}

export function showRun(args: ShowRunArgs): ShowRunResult | null {
  const meta = args.runsIo.readMeta(args.runId);
  if (meta === null) return null;
  const m = meta as unknown as RunMeta;
  const finalMd = args.runsIo.readFinalMd(args.runId);

  if (!args.withRounds) {
    return { meta: m, finalMd };
  }

  // 从 events.jsonl 抽取 agent_responded 事件
  const events = args.runsIo.readEvents(args.runId);
  const rounds: Array<{ round: number; agent: string; rawOutput: string }> = [];
  for (const evt of events) {
    if (evt.type !== 'agent_responded') continue;
    const data = evt.data as Record<string, unknown>;
    const agent = (data.agent as string | undefined) ?? '(unknown)';
    const rawOutput = (data.raw_output as string | undefined) ?? JSON.stringify(data.output);
    rounds.push({
      round: evt.round ?? 0,
      agent,
      rawOutput,
    });
  }
  return { meta: m, finalMd, rounds };
}

/**
 * rtai export <uuid> --format=md：返回 final.md 内容；不支持的 format throw。
 */
export class ExportFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportFormatError';
  }
}

export function exportRun(args: { runsIo: RunsIo; runId: string; format: string }): string {
  if (args.format !== 'md') {
    throw new ExportFormatError(`unsupported format ${args.format}; v1 supports only md`);
  }
  const content = args.runsIo.readFinalMd(args.runId);
  if (content === null) {
    throw new ExportFormatError(`runs/${args.runId}/final.md 不存在`);
  }
  return content;
}

/**
 * History 保留策略 prune（启动时调用）。
 *
 * 来自 §persistence-history "history 保留策略" Requirement + tasks.md §17.9：
 * - unlimited：不清理
 * - last_N：仅保留最近 N 条
 * - ttl_Ndays：仅保留最近 N 天
 *
 * 返回被删除的 run_id 列表（用于 warn / debug）。
 */
export function pruneHistory(args: {
  runsIo: RunsIo;
  runsDir: string;
  policy: PrefsFile['history']['retain_runs'];
  now?: Date;
}): string[] {
  const now = args.now ?? new Date();

  if (args.policy === 'unlimited') return [];

  let entries: string[];
  try {
    entries = readdirSync(args.runsDir);
  } catch {
    return [];
  }

  // 收集所有 run + started_at（按 meta.json）
  const runs: Array<{ run_id: string; startedAt: Date }> = [];
  for (const entry of entries) {
    if (!isValidUuidV4(entry)) continue;
    const meta = args.runsIo.readMeta(entry);
    if (meta === null) continue;
    const startedAt = meta.started_at;
    if (typeof startedAt !== 'string') continue;
    const date = new Date(startedAt);
    if (Number.isNaN(date.getTime())) continue;
    runs.push({ run_id: entry, startedAt: date });
  }
  runs.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

  const toDelete: string[] = [];

  if (args.policy.startsWith('last_')) {
    const n = Number(args.policy.slice('last_'.length));
    if (!Number.isInteger(n) || n < 0) return [];
    if (runs.length <= n) return [];
    toDelete.push(...runs.slice(n).map((r) => r.run_id));
  } else if (args.policy.startsWith('ttl_') && args.policy.endsWith('days')) {
    const daysStr = args.policy.slice('ttl_'.length, -'days'.length);
    const days = Number(daysStr);
    if (!Number.isInteger(days) || days < 0) return [];
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    for (const r of runs) {
      if (r.startedAt < cutoff) toDelete.push(r.run_id);
    }
  }

  // 删除目录
  for (const runId of toDelete) {
    try {
      rmSync(args.runsIo.runDir(runId), { recursive: true, force: true });
    } catch {
      // 忽略
    }
  }
  return toDelete;
}

/**
 * rtai history forget <uuid>：删除指定 run 目录。
 */
export function forgetRun(args: { runsIo: RunsIo; runId: string }): boolean {
  const dir = args.runsIo.runDir(args.runId);
  try {
    statSync(dir);
  } catch {
    return false;
  }
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * rtai history clear：删除所有 run 目录。
 *
 * 调用方应已经做过用户 Y/n 确认。
 */
export function clearHistory(args: { runsIo: RunsIo; runsDir: string }): number {
  let count = 0;
  let entries: string[];
  try {
    entries = readdirSync(args.runsDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!isValidUuidV4(entry)) continue;
    try {
      rmSync(args.runsIo.runDir(entry), { recursive: true, force: true });
      count++;
    } catch {
      // 忽略
    }
  }
  return count;
}
