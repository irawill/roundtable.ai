import { t } from '../shared/lang/packs.js';
import type { Round1Output, Round2PlusOutput } from '../shared/agent-output-schema.js';
import { buildDisagreementMatrix, renderMatrixMarkdown } from './disagreement-matrix.js';
import { computeConsensus } from './normalize.js';

/**
 * 多 agent 未收敛（escaped）路径渲染。
 *
 * 来自 §finalizer "多 agent 未收敛路径渲染" + "Finalizer 输出语言"
 * + 跨阶段约束 #9 三路径 Finalizer 渲染契约 + tasks.md §11.4-§11.7。
 *
 * 输出结构：
 *   # {enhanced_question 第一行截取}
 *
 *   ## 共识部分
 *   - <consensus claim 1>
 *   - <consensus claim 2>
 *
 *   ## 分歧矩阵
 *   | 分歧点 | claude | codex | gemini |
 *   | --- | --- | --- | --- |
 *   | ... | ... | ... | ... |
 *
 *   ## 各家完整答案
 *   <details><summary>claude</summary>
 *
 *   {claude.answer}
 *
 *   </details>
 *   ...
 *
 *   ## 你的下一步
 *   - 重点 spot-check 以下分歧点：...
 *
 *   ---
 *   {footer}
 */

import type { RenderConvergedArgs } from './converged.js';

const TITLE_MAX_LENGTH = 60;
const TITLE_FALLBACK_KEY = 'finalizer.title.default';

export interface RenderEscapedArgs {
  /** Enhancer 后的 enhanced_question */
  enhancedQuestion: string;
  /** 每个 active agent 的最后一轮 round 2+ 输出 */
  agentOutputs: ReadonlyMap<string, Round1Output | Round2PlusOutput>;
  /** scene 名 */
  scene: string;
  /** 完成轮数 */
  roundsCompleted: number;
  /** 所有 active agent 名（顺序与 agentOutputs 一致） */
  participants: readonly string[];
  /** run_id */
  runId: string;
  /** resolved_ui_language */
  resolvedUiLanguage: string;
  /** 是否 --no-persist 模式 */
  noPersist?: boolean;
}

/**
 * 渲染 escaped 路径 markdown。
 */
export function renderEscaped(args: RenderEscapedArgs): string {
  const lang = args.resolvedUiLanguage;
  const title = extractTitle(args.enhancedQuestion, lang);

  // 1. 共识部分（key_claims 字面 set 交集）
  const claimsMap = new Map<string, readonly string[]>();
  for (const [agent, output] of args.agentOutputs) {
    claimsMap.set(agent, output.key_claims);
  }
  const consensus = computeConsensus(claimsMap);

  // 2. 分歧矩阵
  const matrix = buildDisagreementMatrix({ agentOutputs: args.agentOutputs });
  const matrixMarkdown = renderMatrixMarkdown(matrix, t(lang, 'finalizer.section.disagreements'));

  // 3. 各家完整答案（折叠块）
  const fullAnswers: string[] = [];
  for (const agent of args.participants) {
    const output = args.agentOutputs.get(agent);
    if (!output) continue;
    fullAnswers.push(
      `<details>\n<summary>${escapeHtml(agent)}</summary>\n\n${output.answer}\n\n</details>`,
    );
  }

  // 4. 你的下一步
  const nextSteps = buildNextSteps(matrix.rows.map((r) => r.claim));

  // 5. footer
  const footer = renderFooter({ ...args, lang });

  const sections: string[] = [
    `# ${title}`,
    '',
    `## ${t(lang, 'finalizer.section.consensus')}`,
    '',
    consensus.length === 0 ? '_无字面相同的 key_claims（多 agent 视角差异较大）。_' : consensus.map((c) => `- ${c}`).join('\n'),
    '',
    `## ${t(lang, 'finalizer.section.disagreements')}`,
    '',
    matrixMarkdown,
    '',
    `## ${t(lang, 'finalizer.section.full_answers')}`,
    '',
    fullAnswers.join('\n\n'),
    '',
    `## ${t(lang, 'finalizer.section.next_steps')}`,
    '',
    nextSteps,
    '',
    '---',
    '',
    footer,
  ];
  return sections.join('\n');
}

function extractTitle(enhancedQuestion: string, uiLang: string): string {
  const firstLine = enhancedQuestion.split('\n')[0]?.trim() ?? '';
  if (firstLine === '') return t(uiLang, TITLE_FALLBACK_KEY);
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return Array.from(firstLine).slice(0, TITLE_MAX_LENGTH).join('') + '…';
}

function buildNextSteps(claims: readonly string[]): string {
  if (claims.length === 0) {
    return '- _本轮无显著分歧，结论可直接采用各家答案的并集（参考"各家完整答案"段）。_';
  }
  const lines: string[] = ['- 重点 spot-check 以下分歧点（建议人工核实事实层 disagreement）：'];
  for (const claim of claims.slice(0, 5)) {
    lines.push(`  - ${claim}`);
  }
  return lines.join('\n');
}

function renderFooter(
  args: Omit<RenderEscapedArgs, 'agentOutputs' | 'resolvedUiLanguage'> & { lang: string },
): string {
  const parts: string[] = [];
  parts.push(`*${t(args.lang, 'finalizer.footer.scene')}: ${args.scene}*`);
  parts.push(`*${t(args.lang, 'finalizer.footer.rounds')}: ${args.roundsCompleted}*`);
  parts.push(
    `*${t(args.lang, 'finalizer.footer.participants')}: ${args.participants.join(' / ')}*`,
  );
  if (!args.noPersist) {
    parts.push(`*${t(args.lang, 'finalizer.footer.run_id')}: \`${args.runId}\`*`);
  } else {
    parts.push(`*${t(args.lang, 'no_persist.final_md_note')}*`);
  }
  return parts.join('  \n');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 重新导出以便测试与外部使用
export type { RenderConvergedArgs };
