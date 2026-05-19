import { t } from '../shared/lang/packs.js';
import type { Round1Output, Round2PlusOutput } from '../shared/agent-output-schema.js';

/**
 * 多 agent 收敛路径渲染（轻包装）。
 *
 * 来自 §finalizer "多 agent 收敛路径（轻包装，无 LLM 介入）" + "Finalizer 收敛路径不调用 LLM
 * 且不重新格式化" + 跨阶段约束 #9 三路径 Finalizer 渲染契约 + tasks.md §11.3。
 *
 * **核心约定**：
 * - 取 executor.last_round.answer **原文**（不重新格式化、不调 LLM、不改顺序、不缩减）
 * - 前后包装 H1 标题 + footer
 * - **不**从自由文本生成对比表 / 引用块 / pros-cons（这些约束已前移到 agent prompt）
 *
 * 输出结构：
 *   # {enhanced_question 第一行截取，最多 60 字符；fallback "Roundtable Answer"}
 *
 *   {executor.answer 原文}
 *
 *   ---
 *
 *   *Scene: {scene} | Rounds: {N} | Participants: {...} | Executor: {executor} | Run ID: {uuid}*
 */

export interface RenderConvergedArgs {
  /** Enhancer 后的 enhanced_question（用于截取 H1 标题） */
  enhancedQuestion: string;
  /** executor 最后一轮的 round 2+ 输出 */
  executorOutput: Round1Output | Round2PlusOutput;
  /** scene 名 */
  scene: string;
  /** 完成轮数 */
  roundsCompleted: number;
  /** 所有 participant 名（按 scene.models 顺序） */
  participants: readonly string[];
  /** executor agent 名 */
  executor: string;
  /** run_id（uuid） */
  runId: string;
  /** resolved_ui_language（决定 footer 文案语言） */
  resolvedUiLanguage: string;
  /** 是否 --no-persist 模式（footer 处理变化） */
  noPersist?: boolean;
}

/** H1 截取上限：取 enhanced_question 第一行的前 60 字符。 */
const TITLE_MAX_LENGTH = 60;
const TITLE_FALLBACK_KEY = 'finalizer.title.default';

/**
 * 渲染多 agent 收敛路径的 markdown。
 *
 * 来自 §finalizer "consumer scene 收敛后轻包装" + "不允许收敛后再加工" + "answer 已含对比表则
 * 直接 ship" 三个 Scenario。
 */
export function renderConverged(args: RenderConvergedArgs): string {
  const title = extractTitle(args.enhancedQuestion, args.resolvedUiLanguage);
  const answer = args.executorOutput.answer; // 原文，**不**修改

  const sections: string[] = [`# ${title}`, '', answer, '', '---', '', renderFooter(args)];
  return sections.join('\n');
}

/** 提取 H1 标题：enhanced_question 第一行截取 ≤60 字符；空 / 仅空白 fallback 翻译包默认标题。 */
function extractTitle(enhancedQuestion: string, uiLang: string): string {
  const firstLine = enhancedQuestion.split('\n')[0]?.trim() ?? '';
  if (firstLine === '') return t(uiLang, TITLE_FALLBACK_KEY);
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  // 截取（字符级，非字节）
  return Array.from(firstLine).slice(0, TITLE_MAX_LENGTH).join('') + '…';
}

/**
 * 渲染 footer（scene / rounds / participants / executor / run_id）。
 *
 * 来自 §finalizer "多 agent 收敛路径（轻包装）" + §presenters "--no-persist 模式 final.md
 * footer 标注" + §token-usage-tracking "收敛后 summary table" footer 追加。
 *
 * --no-persist 模式：不显示 run_id 行，额外追加 ephemeral run 注脚（spec 已明示）。
 */
function renderFooter(args: RenderConvergedArgs): string {
  const lang = args.resolvedUiLanguage;
  const parts: string[] = [];
  parts.push(`*${t(lang, 'finalizer.footer.scene')}: ${args.scene}*`);
  parts.push(`*${t(lang, 'finalizer.footer.rounds')}: ${args.roundsCompleted}*`);
  parts.push(`*${t(lang, 'finalizer.footer.participants')}: ${args.participants.join(' / ')}*`);
  parts.push(`*${t(lang, 'finalizer.footer.executor')}: ${args.executor}*`);
  if (!args.noPersist) {
    parts.push(`*${t(lang, 'finalizer.footer.run_id')}: \`${args.runId}\`*`);
  } else {
    parts.push(`*${t(lang, 'no_persist.final_md_note')}*`);
  }
  return parts.join('  \n'); // markdown 两个空格 + \n = 软换行
}
