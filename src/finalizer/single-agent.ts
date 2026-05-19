import { t } from '../shared/lang/packs.js';
import type { SingleAgentOutput } from '../shared/agent-output-schema.js';

/**
 * 单 agent 路径渲染（direct + downgraded 共享）。
 *
 * 来自 §finalizer "单 agent 路径渲染（direct + downgraded 共享）" + tasks.md §11.8
 * + 跨阶段约束 #9 三路径 Finalizer 渲染契约。
 *
 * 共享渲染逻辑：
 * 1. 取唯一 participant 的 answer
 * 2. 轻量 markdown 包装（H1 + answer 原文）
 * 3. 末尾 footer "由 <agent> 单独作答（未经圆桌评审）"（文案取自 resolved_ui_language 翻译包）
 *
 * **不**调 LLM；**不**根据 scene.output_format 重新生成结构；**不**生成共识 / 分歧矩阵 / 你的下一步。
 * direct / downgraded 仅 meta.json.single_agent_kind 字段区分，渲染层无差别。
 */

const TITLE_MAX_LENGTH = 60;
const TITLE_FALLBACK_KEY = 'finalizer.title.default';

export interface RenderSingleAgentArgs {
  /** 问题文本：direct 路径用 raw_question；downgraded 用 enhanced_question */
  question: string;
  /** 唯一 agent 的输出 */
  output: SingleAgentOutput;
  /** 唯一 agent 名 */
  agent: string;
  /** scene 名（direct 路径恒为 general；downgraded 沿用 Enhancer 检测） */
  scene: string;
  /** run_id */
  runId: string;
  /** resolved_ui_language */
  resolvedUiLanguage: string;
  /** 是否 --no-persist 模式 */
  noPersist?: boolean;
  /** direct / downgraded kind（仅用于 footer 注脚标签；渲染逻辑无差别） */
  singleAgentKind: 'direct' | 'downgraded';
}

/**
 * 渲染单 agent 路径 markdown。
 */
export function renderSingleAgent(args: RenderSingleAgentArgs): string {
  const lang = args.resolvedUiLanguage;
  const title = extractTitle(args.question, lang);
  const answer = args.output.answer;
  const footer = renderFooter(args, lang);

  const sections: string[] = [`# ${title}`, '', answer, '', '---', '', footer];
  return sections.join('\n');
}

function extractTitle(question: string, uiLang: string): string {
  const firstLine = question.split('\n')[0]?.trim() ?? '';
  if (firstLine === '') return t(uiLang, TITLE_FALLBACK_KEY);
  if (firstLine.length <= TITLE_MAX_LENGTH) return firstLine;
  return Array.from(firstLine).slice(0, TITLE_MAX_LENGTH).join('') + '…';
}

function renderFooter(args: RenderSingleAgentArgs, lang: string): string {
  const parts: string[] = [];
  // 主 footer 行：来自翻译包，"由 {agent} 单独作答（未经圆桌评审）"
  parts.push(`*${t(lang, 'finalizer.single_agent.footer', { agent: args.agent })}*`);
  parts.push(`*${t(lang, 'finalizer.footer.scene')}: ${args.scene}*`);
  if (!args.noPersist) {
    parts.push(`*${t(lang, 'finalizer.footer.run_id')}: \`${args.runId}\`*`);
  } else {
    parts.push(`*${t(lang, 'no_persist.final_md_note')}*`);
  }
  return parts.join('  \n');
}
