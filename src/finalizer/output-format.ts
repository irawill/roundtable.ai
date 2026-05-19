/**
 * output_format 风格提示注入（约束前移到 agent prompt）。
 *
 * 来自 §finalizer "output_format 取值与语义（约束前移）" + §scene-system "Scene 影响 7 层运行时行为"
 * + 跨阶段约束 #9 三路径 Finalizer 渲染契约。
 *
 * 核心约定：
 * - output_format 是 **agent prompt 风格提示**，不是 Finalizer 渲染指令
 * - 注入到每轮 prompt（Round 1 / Round 2+ / 单 agent），让 agent **直接输出符合格式的 markdown**
 * - Finalizer 仅做轻包装；agent 输出已含对比表则 Finalizer 原样 ship
 * - 未知 output_format 取值 → 静默 fallback 到 markdown + 启动 warn
 */

/** v1 6 种合法 output_format。 */
export const KNOWN_OUTPUT_FORMATS = [
  'markdown',
  'markdown_with_comparison_table',
  'markdown_with_code_blocks',
  'markdown_with_citations',
  'markdown_with_pros_cons',
  'markdown_with_stepped_reasoning',
] as const;
export type KnownOutputFormat = (typeof KNOWN_OUTPUT_FORMATS)[number];

/**
 * 6 种 output_format 对应的风格提示文案。
 *
 * 文案注入到每轮 prompt 末尾（在 agent_role_prompt + 语言小节之外）。
 * 文案为简体中文（agent 跨语言能理解）。
 */
const FORMAT_PROMPTS: Record<KnownOutputFormat, string> = {
  markdown: 'markdown 自由格式',
  markdown_with_comparison_table:
    'markdown，含产品对比表（型号 / 价格 / 推荐理由 / 已知缺点 等列；视题目自由增减）',
  markdown_with_code_blocks: 'markdown，优先输出可运行代码块（带语言 tag），关键代码加注释',
  markdown_with_citations: 'markdown，关键事实/结论在末尾列引用源（含 URL 或文献标识）',
  markdown_with_pros_cons: 'markdown，含 pros / cons 段（明确利弊权衡，避免"中立综合"）',
  markdown_with_stepped_reasoning:
    'markdown，显式分步推理（每步可验证；不一致时给最小反例 / 子结论）',
};

/**
 * 是否合法 output_format（用于 scene 加载时校验）。
 *
 * 注：scenes.yaml schema 已用 z.enum() 严格枚举校验，本函数主要供运行时防御性使用
 * （如用户自定义 scene 后续用未来添加的 format 名）。
 */
export function isKnownOutputFormat(value: string): value is KnownOutputFormat {
  return (KNOWN_OUTPUT_FORMATS as readonly string[]).includes(value);
}

export interface BuildFormatPromptResult {
  /** 注入到 agent prompt 的风格提示行；若 fallback 到 markdown，仍返回 markdown 提示 */
  promptLine: string;
  /** 是否触发 fallback（即 output_format 不在 6 种合法值内） */
  fellBack: boolean;
  /** fallback 时填充：原始非法 value */
  originalValue?: string;
}

/**
 * 构造 agent prompt 末尾的风格提示行。
 *
 * 注入位置（由 Round prompt 拼装层负责）：scene.agent_role_prompt + 语言小节之外，独立一行：
 *
 *   **期望输出格式**：{description}
 *
 * 来自 §finalizer "output_format 取值与语义（约束前移）" Scenario "consumer scene 把对比表要求注入 prompt"。
 *
 * @param outputFormat  scene.output_format 字段值
 * @returns promptLine + fellBack 标记
 */
export function buildFormatPromptLine(outputFormat: string): BuildFormatPromptResult {
  if (isKnownOutputFormat(outputFormat)) {
    return {
      promptLine: `**期望输出格式**：${FORMAT_PROMPTS[outputFormat]}`,
      fellBack: false,
    };
  }
  // 未知值 → fallback markdown + warn（warn 由调用方在加载 scene 时 emit）
  return {
    promptLine: `**期望输出格式**：${FORMAT_PROMPTS.markdown}`,
    fellBack: true,
    originalValue: outputFormat,
  };
}
