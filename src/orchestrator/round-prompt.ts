import { buildLanguageInstruction } from '../lang/instruction.js';
import type { SceneConfig } from '../config/schemas/scenes.js';
import { buildFormatPromptLine } from '../finalizer/output-format.js';
import { t } from '../shared/lang/packs.js';
import type { PriorChainEntry } from '../persistence/followup.js';

/**
 * 把追问链拼成"先前讨论的链路 + 本轮追问"段落。
 *
 * 空 chain 返回空串；非空时返回 header + 每段 round label + final.md + current turn header。
 * 标题与 round label 走 i18n 翻译包（fallback 到 en）。
 */
export function buildPriorChainSection(
  chain: readonly PriorChainEntry[],
  outputLanguage: string,
): string {
  if (chain.length === 0) return '';
  const header = t(outputLanguage, 'followup.priorChainHeader');
  const roundLabel = t(outputLanguage, 'followup.roundLabel');
  const currentHeader = t(outputLanguage, 'followup.currentTurnHeader');
  const parts: string[] = [`# ${header}`];
  chain.forEach((e, i) => {
    parts.push(`## ${roundLabel} ${i + 1}：${e.enhancedQuestion}`);
    parts.push(e.finalMd);
  });
  parts.push(`# ${currentHeader}`);
  return parts.join('\n\n');
}

/**
 * Round prompt 拼装。
 *
 * 来自 §roundtable-orchestrator "Round 1 schema 简化" + "Round 2+ schema 完整且 peer_review 覆盖性强制"
 * + "Round 2+ prompt 包含上轮其他 agent 输出" + "防"礼貌性同意"的 prompt 注入"
 * + §language-support "Round prompt 末尾追加语言指令" + §finalizer "output_format 取值与语义（约束前移）"。
 *
 * 通用结构（Round 1 / Round 2+ 共享前 3 段）：
 *   1. enhanced_question
 *   2. scene.agent_role_prompt（注入每个 agent 的角色 prompt）
 *   3. output_format 风格提示
 *
 * Round 1 仅 schema 简化提示。
 *
 * Round 2+ 在此基础上追加：
 *   4. 上轮所有其他 active agent 输出（=== Agent X === 分段）
 *   5. peer_review 覆盖性要求（明示当前 agent 必须含且仅含哪些 agent）
 *   6. 防"礼貌性同意"四条注入
 *   7. Round 2+ schema 字段提示
 *
 * 所有 round 末尾追加语言指令小节。
 */

/** Round 1 schema 简化提示（来自 §roundtable-orchestrator "Round 1 schema 简化"）。 */
const ROUND1_SCHEMA_HINT = `**输出格式**：仅输出符合下述 schema 的 JSON 对象，不要前后加解释文本、不要包 markdown code fence。

\`\`\`json
{
  "answer": "<完整答案，按上述期望输出格式书写 markdown>",
  "key_claims": [ "<可被复用为共识候选的简短主张 1>", "..." ],
  "uncertainty_notes": [ "<不确定的点，可空数组>" ],
  "search_evidence": [ { "url": "...", "snippet": "...", "source": "..." } ]
}
\`\`\``;

/** Round 2+ schema 完整提示（来自 §roundtable-orchestrator "Round 2+ schema 完整且 peer_review 覆盖性强制"）。 */
function round2PlusSchemaHint(otherAgents: readonly string[]): string {
  const list = otherAgents.map((a) => `"${a}"`).join(' / ');
  return `**输出格式**：仅输出符合下述 schema 的 JSON 对象。

\`\`\`json
{
  "answer": "<完整答案>",
  "key_claims": [ "<...>" ],
  "uncertainty_notes": [ "<可空>" ],
  "search_evidence": [ /* 可空 */ ],
  "self_stability": "stable | refining",
  "self_change_summary": "<相对上轮的改动摘要>",
  "peer_review": [
    {
      "agent": "<must be one of: ${list}>",
      "agree": true | false,
      "agreement_basis": "<agree=true 时必填非空理由；agree=false 时可空>",
      "disagreements": [
        { "claim": "<对方的主张>", "my_view": "<你的反驳>", "type": "factual | reasoning | cosmetic | alternative_view" }
      ]
    }
  ]
}
\`\`\`

**peer_review 必须**：
- 含且仅含 ${list} ${otherAgents.length} 个 agent（不漏、不重、不评审自己、不评审非 active）
- agree=true 时 \`agreement_basis\` MUST 非空（至少一句独立验证理由）
- agree=false 时 \`disagreements\` MUST 至少 1 条（具体可检验的分歧）`;
}

/** 防"礼貌性同意"四条注入（来自 §roundtable-orchestrator "防"礼貌性同意"的 prompt 注入"）。 */
const ANTI_POLITE_RULES = `**讨论硬规则**（防止礼貌性同意）：

- 不要因为礼貌而同意。如果对方有事实错误、信息缺失、推理跳跃，必须明确指出。
- 如果你 \`agree=true\`，给出至少一句话理由说明哪些点你**独立验证过**。
- 如果你 \`agree=false\`，必须列至少一条**具体可检验**的分歧（事实层面或推理层面），不能为空。
- 分歧点必须是**具体可检验**的（事实层面或推理层面），**不能是"风格不同"**。`;

export interface BuildRound1PromptArgs {
  /** Enhancer 后的 enhanced_question（含用户答案追加） */
  enhancedQuestion: string;
  /** 当前 scene 配置 */
  scene: SceneConfig;
  /** resolved_output_language（用于语言指令小节） */
  resolvedOutputLanguage: string;
  /** 追问链（最旧在前，含 parent）；空或缺省时不注入 prior_chain 段 */
  priorChain?: readonly PriorChainEntry[];
}

/**
 * Round 1 prompt。
 *
 * 来自 §roundtable-orchestrator "Round 1 schema 简化"：不含上轮 output；schema 仅含 answer +
 * key_claims + uncertainty_notes + search_evidence；**不**含 self_stability / peer_review。
 *
 * Round 1 强制忽略 self_stability=stable（防过早收敛）——schema 不要求该字段，prompt 也不提；
 * 即使 agent 误送，由收敛判定层忽略（详见 §roundtable-orchestrator "Round 1 不允许 stable"）。
 */
export function buildRound1Prompt(args: BuildRound1PromptArgs): string {
  const sections: string[] = [
    `# 用户问题（含 Enhancer 补全）\n\n${args.enhancedQuestion}`,
  ];
  if (args.priorChain !== undefined && args.priorChain.length > 0) {
    sections.push(buildPriorChainSection(args.priorChain, args.resolvedOutputLanguage));
  }
  sections.push(
    `## 角色 prompt\n\n${args.scene.agent_role_prompt.trim()}`,
    buildFormatPromptLine(args.scene.output_format).promptLine,
    ROUND1_SCHEMA_HINT,
    buildLanguageInstruction({ resolvedOutputLanguage: args.resolvedOutputLanguage, round: 1 }),
  );
  return sections.join('\n\n---\n\n');
}

export interface BuildRound2PlusPromptArgs {
  /** Enhancer 后的 enhanced_question */
  enhancedQuestion: string;
  /** 当前 scene 配置 */
  scene: SceneConfig;
  /** 当前 agent 名（写 prompt 给谁；用于排除自己 + 列出其他 active agents） */
  selfAgent: string;
  /** 当前轮号（从 2 起） */
  round: number;
  /** 上一轮所有 active agent 的输出（结构化 JSON 字符串） */
  previousOutputs: Record<string, string>;
  /** 本轮 active agents 列表（含 selfAgent） */
  activeAgents: readonly string[];
  /** resolved_output_language */
  resolvedOutputLanguage: string;
}

/**
 * Round 2+ prompt。
 *
 * 来自 §roundtable-orchestrator "Round 2+ prompt 包含上轮其他 agent 输出"
 * + "防"礼貌性同意"的 prompt 注入" + "Round 2+ schema 完整且 peer_review 覆盖性强制"。
 */
export function buildRound2PlusPrompt(args: BuildRound2PlusPromptArgs): string {
  const otherAgents = args.activeAgents.filter((a) => a !== args.selfAgent);

  // 上轮其他 agent 输出，按 === Agent X === 分段
  const previousSections: string[] = ['## 上一轮所有其他 agent 输出'];
  if (otherAgents.length === 0) {
    previousSections.push('(无其他 active agent —— 这种情况理论上不应进入 Round 2+，可能是 bug)');
  } else {
    for (const agent of otherAgents) {
      const output = args.previousOutputs[agent];
      if (output === undefined) {
        previousSections.push(
          `=== Agent ${agent} 的答案（上一轮 ERRORED 或 missing） ===\n\n(本轮请仍要给出 peer_review，建议 agree=false 并 disagreement.type=factual 解释原因)`,
        );
        continue;
      }
      previousSections.push(`=== Agent ${agent} 的答案 ===\n\n${output}`);
    }
  }

  const sections: string[] = [
    `# 用户问题（含 Enhancer 补全）\n\n${args.enhancedQuestion}`,
    `## 角色 prompt\n\n${args.scene.agent_role_prompt.trim()}`,
    buildFormatPromptLine(args.scene.output_format).promptLine,
    previousSections.join('\n\n'),
    ANTI_POLITE_RULES,
    `# 当前回合\n\n你是 \`${args.selfAgent}\`，当前是 **Round ${args.round}**。请重新作答（参考他人观点但不要为礼貌而同意），并对每个其他 active agent 给 peer_review。`,
    round2PlusSchemaHint(otherAgents),
    buildLanguageInstruction({ resolvedOutputLanguage: args.resolvedOutputLanguage, round: args.round }),
  ];
  return sections.join('\n\n---\n\n');
}

/**
 * 把单 agent 路径的 prompt 拼装（direct + downgraded 共享）。
 *
 * 来自 §roundtable-orchestrator "单 agent 路径（两种进入方式共享行为）"：
 * - direct：raw_question + scene 强制 general + 跳过 Enhancer
 * - downgraded：enhanced_question + scene 沿用 Enhancer 检测（或 fallback general）
 *
 * 两者共享：schema 仅要求 answer；不要求 peer_review / self_stability；不进入 round loop。
 * 本函数只产 prompt，状态机分支由调用方决定。
 */
export interface BuildSingleAgentPromptArgs {
  /** direct 路径用 raw_question；downgraded 路径用 enhanced_question */
  question: string;
  /** 当前 scene（direct 路径强制 general scene） */
  scene: SceneConfig;
  /** resolved_output_language */
  resolvedOutputLanguage: string;
}

const SINGLE_AGENT_SCHEMA_HINT = `**输出格式**：仅输出符合下述 schema 的 JSON 对象。

\`\`\`json
{
  "answer": "<完整答案，按上述期望输出格式书写 markdown>"
}
\`\`\`

注：本次为单 agent 路径，**无**圆桌评审；不需要 \`peer_review\` / \`self_stability\` / \`key_claims\` 字段。`;

export function buildSingleAgentPrompt(args: BuildSingleAgentPromptArgs): string {
  const sections: string[] = [
    `# 用户问题\n\n${args.question}`,
    `## 角色 prompt\n\n${args.scene.agent_role_prompt.trim()}`,
    buildFormatPromptLine(args.scene.output_format).promptLine,
    SINGLE_AGENT_SCHEMA_HINT,
    buildLanguageInstruction({ resolvedOutputLanguage: args.resolvedOutputLanguage, round: 1 }),
  ];
  return sections.join('\n\n---\n\n');
}
