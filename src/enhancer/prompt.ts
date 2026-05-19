import type { ScenesFile } from '../config/schemas/scenes.js';
import type { PriorChainEntry } from '../persistence/followup.js';

/**
 * Enhancer prompt 拼装。
 *
 * 来自 §question-enhancer "单次 LLM 调用同时完成 4 件事" + "scene_confidence 阈值回退"
 * + "命令行 `--scene` 强制 override" + "用户答案直接拼装，不二次调用 Enhancer"
 * + "不主观注入用户偏好倾向" + "语言一致性的 Enhancer 输出" + "代码标识符保持原文"
 * + 跨阶段约束 #3 命名约定。
 *
 * 两种模式：
 * - **auto**（requested_output_language == 'auto'）：Enhancer 顺带检测 user_language；
 *   所有字符串字段用检测到的语言输出；schema 额外要求 user_language + language_confidence
 * - **explicit**（requested_output_language 为 'system' 或显式 BCP-47）：用已 resolved 的语言输出；
 *   schema **不**要求 language 字段
 *
 * --scene=&lt;x&gt; override：Enhancer 仍执行（用于补全 + 反问 + 语言检测），但调用方在 Enhancer
 * 返回后**忽略** detected_scene 字段（详见 §question-enhancer "命令行 `--scene` 强制 override"）。
 * prompt 拼装阶段不需要为 --scene 做特殊处理——保持 detect 行为，让 schema 仍按 ≥0.8 信心
 * 等条件流动，detected_scene 字段在结果消费层被覆盖即可。
 */

export interface BuildEnhancerPromptArgs {
  /** 用户原始问题 */
  rawQuestion: string;
  /** 全部 scenes（含 v1 内置 7 个 + 用户自定义）；用于让 Enhancer 知道可选 scene 名单 */
  scenes: ScenesFile;
  /** 模式 */
  mode: 'auto' | 'explicit';
  /** explicit 模式必填：用 resolved_output_language（如 zh-Hans / en / ja）输出所有字符串字段 */
  resolvedOutputLanguage?: string;
  /**
   * 追问链：非空时拼前置 [这是用户的追问] 段，告知 enhancer 可延用同一 scene 或切换。
   * 最旧在前，含 parent。
   */
  priorChain?: readonly PriorChainEntry[];
}

/**
 * 主入口。返回完整 system + user prompt 字符串，交给 adapter.invoke。
 */
export function buildEnhancerPrompt(args: BuildEnhancerPromptArgs): string {
  const sections = [
    SYSTEM_HEADER,
    sceneCatalog(args.scenes),
    NO_BIAS_RULES,
    DIMENSION_PREFIX_RULE,
    QUESTIONS_LIMIT_RULE,
    CODE_IDENTIFIERS_RULE,
    args.mode === 'auto' ? LANGUAGE_AUTO_RULE : languageExplicitRule(args.resolvedOutputLanguage ?? 'en'),
    OUTPUT_FORMAT_RULE,
  ];
  if (args.priorChain !== undefined && args.priorChain.length > 0) {
    sections.push(buildFollowupContextRule(args.priorChain));
  }
  sections.push(`## 用户原始问题\n\n${args.rawQuestion}`);
  return sections.join('\n\n---\n\n');
}

/**
 * 追问场景前置说明：告知 enhancer 这是追问，可延用 parent 的 scene 或切换；
 * 参考链路上下文做问题改写，但不要复述全部历史。
 */
function buildFollowupContextRule(chain: readonly PriorChainEntry[]): string {
  const parts: string[] = [
    '## 这是用户的追问',
    '',
    '以下是先前讨论的链路（最旧到最新）。请据此决定本次 scene 是延用还是切换；',
    '`enhanced_question_so_far` 应当**仅**改写本轮追问本身（让它含必要补全），',
    '不要把历史结论复述进去——下游 agent 会单独看到链路。',
    '',
  ];
  chain.forEach((e, i) => {
    parts.push(`### 第 ${i + 1} 轮：${e.enhancedQuestion}`);
    parts.push('');
    parts.push(e.finalMd);
    parts.push('');
  });
  parts.push('### 本轮追问原文（再次出现于下方"用户原始问题"段）');
  return parts.join('\n');
}

const SYSTEM_HEADER = `# 角色

你是 Roundtable.ai 的 Question Enhancer。在单次回答中同时完成 4 件事：

1. **识别 scene**：从下方"可选 scene 清单"选最合适的一个；同时给出 0..1 的 \`scene_confidence\`
   与一句话 \`scene_reasoning\`。
2. **自动补全可推断维度**：把问题语义中能合理推断的关键维度（如使用场景、预算、运行环境等）
   填入 \`inferred_dimensions\`（**所有值字符串必须以 "[推断]" 前缀开头**）。
3. **拼装 enhanced_question_so_far**：把推断维度合并到原始问题，得到更清晰的问句。
4. **反问 ≤ 3 个对答案质量有显著影响的关键问题**，写入 \`questions_for_user[]\`。`;

function sceneCatalog(scenes: ScenesFile): string {
  const lines: string[] = ['## 可选 scene 清单（任选其一）'];
  for (const [name, scene] of Object.entries(scenes.scenes)) {
    lines.push(`- **${name}**：${scene.description}`);
    if (scene.enhancer_focus.trim() !== '') {
      lines.push(`  关注：${scene.enhancer_focus.trim()}`);
    }
  }
  return lines.join('\n');
}

const NO_BIAS_RULES = `## 中立性硬规则

- **不要凭空添加倾向词**：原问题没提到"环保"/"极简"/"性价比"/"颜值党"/"国货"等价值取向，
  你的 \`inferred_dimensions\` MUST NOT 出现这些倾向词。
- 只补"问题语义中能合理推断"的维度（如"扫地机器人" → 推断"使用场景=家用清洁"，但**不**推断"风格=极简"）。
- 不确定的维度宁可不写也不要瞎填。`;

const DIMENSION_PREFIX_RULE = `## 推断维度格式

\`inferred_dimensions\` 是一个对象，**键自由命名**（snake_case），**每个值字符串都必须以
"[推断]" 前缀开头**——这是 Roundtable.ai 内部约定，便于下游 agent 区分用户明确表达 vs Enhancer 推断。

示例：
\`\`\`json
{
  "inferred_dimensions": {
    "usage_scenario": "[推断] 家用日常清洁",
    "budget_hint": "[推断] 中端 2000-4000 元区间"
  }
}
\`\`\``;

const QUESTIONS_LIMIT_RULE = `## 反问数量上限

\`questions_for_user\` MUST 是数组且**最多 3 项**。每个问题应当：

- 是会**显著影响答案质量**的关键决策点（不是无关紧要的细节）
- 用一句话表达，不要嵌套子问题
- 避免重复 \`inferred_dimensions\` 已经合理推断出的字段（除非置信度低、想确认）

如果你判断无需反问（问题已足够清晰），返回空数组 \`[]\`。`;

const CODE_IDENTIFIERS_RULE = `## 代码标识符保持原文

输出字符串字段时，以下内容 MUST 保持原文（不翻译、不改写）：
- 代码标识符（函数名、变量名、类名）、API 名、库名、文件路径、URL
- 错误码、版本号（如 \`v1.2.3\` / \`HTTP 401\`）
- 公认专有名词（React / TypeScript / Kubernetes / CSV / JSON / GraphQL 等）`;

const LANGUAGE_AUTO_RULE = `## 语言（auto 模式）

用户的 \`requested_output_language\` 是 \`auto\`——请你**同时**完成语言检测：

1. 识别用户问题的主要语言，输出 BCP-47 标签到 \`user_language\`（如 \`zh-Hans\` / \`zh-Hant\` /
   \`ja\` / \`en\` / \`fr\` / \`de\` 等）。
2. 输出 0..1 的 \`language_confidence\`（混合语言时取较低值）。
3. **用 \`user_language\` 输出所有字符串字段**（\`scene_reasoning\` /
   \`inferred_dimensions\` 的值 / \`enhanced_question_so_far\` / \`questions_for_user[]\`）。

注：代码标识符等仍按上一条规则保持原文。`;

function languageExplicitRule(resolved: string): string {
  return `## 语言（explicit 模式）

用户已明确指定输出语言为 \`${resolved}\`（BCP-47）。**用该语言输出所有字符串字段**
（\`scene_reasoning\` / \`inferred_dimensions\` 的值 / \`enhanced_question_so_far\` /
\`questions_for_user[]\`）。

**不要**返回 \`user_language\` 或 \`language_confidence\` 字段（若返回会被忽略）。
注：代码标识符等仍按上一条规则保持原文。`;
}

const OUTPUT_FORMAT_RULE = `## 输出格式

**仅输出符合下述 schema 的 JSON 对象**，不要在前后加任何解释文本、不要包 markdown code fence。

\`\`\`json
{
  "detected_scene": "<scene name from the catalog>",
  "scene_confidence": <0..1>,
  "scene_reasoning": "<一句话推理>",
  "inferred_dimensions": { "<key>": "[推断] <value>", ... },
  "enhanced_question_so_far": "<拼装后的清晰问句>",
  "questions_for_user": [ "<question 1>", "<question 2>", "<question 3>" ],
  "user_language": "<BCP-47, auto 模式必填>",
  "language_confidence": <0..1, auto 模式必填>
}
\`\`\``;
