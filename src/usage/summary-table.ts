import type { UsageMatrix } from './aggregator.js';

/**
 * Token usage summary table 渲染。
 *
 * 来自 §token-usage-tracking "收敛后 summary table" + "history 显示总 token"
 * + tasks.md §15.4 §15.6 + 跨阶段约束 #13。
 *
 * 列：Agent | Rounds | Input | Output | Cached | Reasoning | Total
 * - null 显示 "-"（与 0 区分）
 * - TOTAL 行：仅累加非 null
 * - k 单位渲染：≥1000 时显示 "1.2k"
 *
 * 输出位置规则（由 stdout / TUI presenter 决定）：
 * - TUI on → 渲染在 TUI 关闭前最后一屏
 * - TUI off → 写入 stderr
 * - 同时作为 footer 追加到 runs/<run_id>/final.md 末尾
 * - stdout 永远 NOT 独立打印 summary table（保持 stdout 仅承载 final.md 的不变量）
 */

export interface SummaryRowAgent {
  agent: string;
  rounds: number; // 该 agent 实际跑过的轮数（含 ERRORED 轮）
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  total: number | null;
}

export interface SummaryTable {
  rows: SummaryRowAgent[];
  totalRow: {
    agents: number; // 参与的 agent 数
    rounds: number; // 总轮数（sum across agents）
    input_tokens: number | null;
    output_tokens: number | null;
    cached_input_tokens: number | null;
    reasoning_tokens: number | null;
    total: number | null;
  };
}

/**
 * 从 UsageMatrix 构造 SummaryTable。
 */
export function buildSummaryTable(matrix: UsageMatrix): SummaryTable {
  const rows: SummaryRowAgent[] = [];
  const totalRow = {
    agents: 0,
    rounds: 0,
    input_tokens: null as number | null,
    output_tokens: null as number | null,
    cached_input_tokens: null as number | null,
    reasoning_tokens: null as number | null,
    total: null as number | null,
  };

  for (const [agent, byRound] of Object.entries(matrix)) {
    let input = 0;
    let output = 0;
    let cached = 0;
    let reasoning = 0;
    let hasInput = false;
    let hasOutput = false;
    let hasCached = false;
    let hasReasoning = false;
    const roundsCount = Object.keys(byRound).length;

    for (const usage of Object.values(byRound)) {
      if (usage === null) continue;
      input += usage.input_tokens;
      output += usage.output_tokens;
      hasInput = true;
      hasOutput = true;
      if (usage.cached_input_tokens !== undefined) {
        cached += usage.cached_input_tokens;
        hasCached = true;
      }
      if (usage.reasoning_tokens !== undefined) {
        reasoning += usage.reasoning_tokens;
        hasReasoning = true;
      }
    }

    const total = hasInput || hasOutput
      ? input + output + (hasCached ? cached : 0) + (hasReasoning ? reasoning : 0)
      : null;

    rows.push({
      agent,
      rounds: roundsCount,
      input_tokens: hasInput ? input : null,
      output_tokens: hasOutput ? output : null,
      cached_input_tokens: hasCached ? cached : null,
      reasoning_tokens: hasReasoning ? reasoning : null,
      total,
    });

    totalRow.agents++;
    totalRow.rounds += roundsCount;
    if (hasInput) totalRow.input_tokens = (totalRow.input_tokens ?? 0) + input;
    if (hasOutput) totalRow.output_tokens = (totalRow.output_tokens ?? 0) + output;
    if (hasCached) totalRow.cached_input_tokens = (totalRow.cached_input_tokens ?? 0) + cached;
    if (hasReasoning) totalRow.reasoning_tokens = (totalRow.reasoning_tokens ?? 0) + reasoning;
    if (total !== null) totalRow.total = (totalRow.total ?? 0) + total;
  }

  return { rows, totalRow };
}

/**
 * k 单位渲染：≥1000 → "X.Yk"；&lt;1000 → 整数；null → "-"。
 */
export function formatTokenCount(n: number | null): string {
  if (n === null) return '-';
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/**
 * 把 SummaryTable 渲染为 markdown 表格（用于 final.md footer 追加 + history 显示）。
 *
 * 表头：`| Agent | Rounds | Input | Output | Cached | Reasoning | Total |`
 */
export function renderSummaryMarkdown(table: SummaryTable): string {
  const lines: string[] = [];
  lines.push('| Agent | Rounds | Input | Output | Cached | Reasoning | Total |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const row of table.rows) {
    lines.push(
      `| ${row.agent} | ${row.rounds} | ${formatTokenCount(row.input_tokens)} | ${formatTokenCount(row.output_tokens)} | ${formatTokenCount(row.cached_input_tokens)} | ${formatTokenCount(row.reasoning_tokens)} | ${formatTokenCount(row.total)} |`,
    );
  }
  lines.push(
    `| **TOTAL** | ${table.totalRow.rounds} | ${formatTokenCount(table.totalRow.input_tokens)} | ${formatTokenCount(table.totalRow.output_tokens)} | ${formatTokenCount(table.totalRow.cached_input_tokens)} | ${formatTokenCount(table.totalRow.reasoning_tokens)} | ${formatTokenCount(table.totalRow.total)} |`,
  );
  return lines.join('\n');
}

/**
 * 渲染单 agent 内联（用于 TUI 底部 ticker / history 行）。
 *
 * @param provisional  adapter 自报 provisional 流式 usage 时为 true → 加 ~ 前缀
 */
export function renderTickerInline(
  agent: string,
  total: number | null,
  provisional: boolean,
): string {
  if (total === null) return `${agent}=-`;
  const prefix = provisional ? '~' : '';
  return `${agent}=${prefix}${formatTokenCount(total)}`;
}
