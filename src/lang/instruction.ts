import { getPackMeta } from '../shared/lang/packs.js';

/**
 * Round prompt 末尾的语言指令小节。
 *
 * 来自 §language-support "Round prompt 末尾追加语言指令" Requirement
 * + tasks.md §16.10。
 *
 * 用法：Orchestrator 拼装每轮 prompt 时在末尾以 --- 分隔的独立小节追加本输出。
 * Round 2+ 每轮重申一次（避免 LLM 漏看上一轮指令）。单 agent 直通路径也附带。
 *
 * 内容（明示 5 类不翻译内容 + 用 resolved_output_language 输出所有自然语言字段）：
 * 1. answer / key_claims / uncertainty_notes / self_change_summary
 * 2. peer_review[].agreement_basis
 * 3. peer_review[].disagreements[].claim / my_view
 * 4. 不翻译代码块 / 命令 / shell 片段
 * 5. 不翻译标识符 / API 名 / 库名 / 文件路径 / URL
 * 6. 不翻译错误码 / 版本号
 * 7. 不翻译公认专有名词（React / Kubernetes / CSV / JSON 等）
 */

export interface BuildLanguageInstructionArgs {
  /** 已 resolved 的输出语言（BCP-47） */
  resolvedOutputLanguage: string;
  /** 当前轮次（Round 1 / Round 2+ 表述略不同：Round 2+ 提醒"上一轮可能已要求过"） */
  round: number;
}

/**
 * 生成语言指令小节（不含前导 ---）。调用方负责拼接到 prompt 末尾。
 *
 * 返回的字符串以 "## 输出语言" 段标题开始，便于 agent 识别。
 */
export function buildLanguageInstruction(args: BuildLanguageInstructionArgs): string {
  const displayName = getPackMeta(args.resolvedOutputLanguage)?.name ?? args.resolvedOutputLanguage;
  const repeatHint =
    args.round > 1
      ? '\n注：本条指令在每轮 prompt 末尾重申一次；与之前轮次保持一致。'
      : '';

  return `## 输出语言

请用 **${displayName}**（BCP-47: \`${args.resolvedOutputLanguage}\`）输出所有自然语言字段，包括：
- \`answer\` / \`key_claims[]\` / \`uncertainty_notes[]\` / \`self_change_summary\`
- \`peer_review[].agreement_basis\`
- \`peer_review[].disagreements[].claim\` / \`peer_review[].disagreements[].my_view\`

以下内容 MUST 保持原文（不翻译）：
- 代码块 / 命令 / shell 片段
- 代码标识符（函数名 / 变量名 / 类名）/ API 名 / 库名 / 文件路径 / URL
- 错误码 / 版本号
- 公认专有名词（如 React / TypeScript / Kubernetes / CSV / JSON / GraphQL）${repeatHint}`;
}
