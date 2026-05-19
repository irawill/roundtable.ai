import { t } from '../../shared/lang/packs.js';
import { formatTokenCount, renderTickerInline } from '../../usage/summary-table.js';
import type { TuiSnapshot, AgentDisplay } from './state.js';

/**
 * TUI 文本渲染（headless）。
 *
 * 来自 §presenters "TUI presenter" + tasks.md §13.1-§13.4。
 *
 * 设计：把 TuiSnapshot 渲染为字符串（headless），便于单测；
 * 实际 ink React 组件在 `tui-app.tsx`（如果 v0.1.0 落地）。
 * v0.1.0 简化：阶段 6 提供 headless 渲染 + ink 集成留阶段 7 主入口装配（节省复杂度）。
 *
 * 输出格式（简化布局）：
 *
 *   [🚫 ephemeral run]    [🌐 Live view: http://...]
 *   ─────────────────────────────────────────────────
 *   Scene: consumer | Round 2/5
 *
 *   Agents:
 *     ⠋ claude  thinking...
 *     ✔ codex   done
 *     ✗ gemini  errored: timeout
 *
 *   ── token ticker ────────────────────────────────
 *   claude=12k  codex=8k  gemini=-   total=20k
 */

const STATUS_ICONS: Record<AgentDisplay['status'], string> = {
  idle: '·',
  thinking: '⠋',
  done: '✔',
  errored: '✗',
};

export interface RenderTuiArgs {
  snapshot: TuiSnapshot;
  /** UI 语言（用于翻译 footer / banner 文案） */
  resolvedUiLanguage: string;
}

/**
 * 把 snapshot 渲染为 TUI 屏字符串（headless 形式，便于单测）。
 */
export function renderTuiFrame(args: RenderTuiArgs): string {
  const { snapshot, resolvedUiLanguage } = args;
  const lines: string[] = [];

  // 顶部状态栏（横幅 + Web view URL）
  const topRow: string[] = [];
  if (snapshot.noPersist) {
    topRow.push(t(resolvedUiLanguage, 'no_persist.banner'));
  }
  if (snapshot.webViewUrl !== undefined) {
    topRow.push(`🌐 Live view: ${snapshot.webViewUrl}`);
  }
  if (topRow.length > 0) {
    lines.push(topRow.join('  '));
    lines.push('─'.repeat(60));
  }

  // 主标题：Scene + Round
  if (snapshot.isSingleAgent) {
    lines.push(
      `Scene: ${snapshot.scene} | single agent (${snapshot.singleAgentKind ?? '?'})`,
    );
  } else {
    const roundInfo =
      snapshot.maxRounds > 0
        ? `Round ${snapshot.currentRound}/${snapshot.maxRounds}`
        : `Round ${snapshot.currentRound}`;
    lines.push(`Scene: ${snapshot.scene} | ${roundInfo}`);
  }
  lines.push('');

  // Enhancer 反问 / 确认页
  if (snapshot.enhancerQuestions !== undefined && snapshot.enhancerQuestions.length > 0) {
    lines.push('Enhancer 反问：');
    for (const q of snapshot.enhancerQuestions) {
      lines.push(`  · ${q}`);
    }
    lines.push('');
  }
  if (snapshot.awaitingConfirmation !== undefined) {
    lines.push('补全后的问题：');
    lines.push('');
    lines.push(snapshot.awaitingConfirmation.enhancedQuestion);
    lines.push('');
    lines.push('继续 (Y) / 取消 (n) / 编辑 (edit) ?');
    lines.push('');
  }

  // Agent 状态
  if (snapshot.agents.length > 0) {
    lines.push('Agents:');
    for (const a of snapshot.agents) {
      const icon = STATUS_ICONS[a.status];
      const detail = a.status === 'errored' && a.lastError !== undefined ? ` — ${a.lastError}` : '';
      lines.push(`  ${icon} ${a.agent.padEnd(10)} ${a.status}${detail}`);
      if (a.status === 'done' && a.currentRoundAnswerHead !== undefined) {
        const head = a.currentRoundAnswerHead.split('\n').slice(0, 3).join('\n    ');
        lines.push(`    ${head}`);
      }
    }
    lines.push('');
  }

  // 底部 token ticker
  lines.push('─'.repeat(60));
  lines.push(renderTokenTicker(snapshot.agents));

  return lines.join('\n');
}

/**
 * 渲染底部 token ticker（每 agent 分项 + total）。
 *
 * 来自 §token-usage-tracking "TUI 实时 ticker" + tasks.md §13.4。
 *
 * - null 显示 `-`
 * - adapter 自报 provisional 加 `~` 前缀
 * - 累加非 null 项作为 total
 */
export function renderTokenTicker(agents: readonly AgentDisplay[]): string {
  const parts: string[] = [];
  let total: number | null = null;
  for (const a of agents) {
    const usage = a.usage;
    if (usage === undefined || usage === null) {
      parts.push(`${a.agent}=-`);
      continue;
    }
    const tokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cached_input_tokens ?? 0) +
      (usage.reasoning_tokens ?? 0);
    parts.push(renderTickerInline(a.agent, tokens, usage.provisional === true));
    total = (total ?? 0) + tokens;
  }
  parts.push(`total=${formatTokenCount(total)}`);
  return parts.join('  ');
}
