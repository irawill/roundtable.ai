/**
 * v1 内置 7 个 scene 的 canonical 文案。
 *
 * 来自 §scene-system "v1 内置 7 个 scene 完整 canonical 文案" Requirement——
 * 7 段 YAML 文案 MUST 逐字编译进二进制；首次 setup 时按下列文案完整写入 scenes.yaml；
 * 启动时 scenes.yaml 缺失会按此重新写入。
 *
 * **修改本文件的字面文案视为破坏性变更**（影响用户已有 scenes.yaml 的 diff 对照），
 * MUST 在 CHANGELOG 中显式声明（来自 §scene-system "字面文案稳定性" Scenario）。
 */

import type { ScenesFile } from '../schemas/scenes.js';

/** Canonical 7 scenes，对象形式 — 与 §scene-system 表格 + YAML 文案逐字一致。 */
export const BUILTIN_SCENES: ScenesFile = {
  scenes: {
    general: {
      description: '默认 fallback，杂类问题',
      models: ['claude', 'codex', 'gemini'],
      min_rounds: 2,
      max_rounds: 4,
      convergence_strictness: 'medium',
      required_capabilities: [],
      effort: 'medium',
      agent_role_prompt:
        '你正在参与圆桌讨论。专注准确性与完整性。\n指出他人答案中的事实错误、信息缺失、推理跳跃。\n',
      enhancer_focus: '识别任何会显著影响答案质量的缺失上下文。\n',
      output_format: 'markdown',
    },
    consumer: {
      description: '产品推荐 / 购买决策 / 选购对比',
      models: ['claude', 'codex', 'gemini'],
      min_rounds: 3,
      max_rounds: 5,
      convergence_strictness: 'medium',
      required_capabilities: ['web_search'],
      effort: 'medium',
      agent_role_prompt:
        '推荐必须引用具体当前产品名、价格、可购买性。\n用搜索验证。区分「我验证过」vs「道听途说」。\n如果不确定型号当前是否在售，明说。\n',
      enhancer_focus: '确认：使用场景、硬约束、预算（或无）、品牌偏好、地域。\n',
      output_format: 'markdown_with_comparison_table',
    },
    coding: {
      description: '编程 / 调试 / 架构 / 技术决策',
      models: ['claude', 'codex'],
      min_rounds: 2,
      max_rounds: 3,
      convergence_strictness: 'strict',
      required_capabilities: ['code_understanding'],
      effort: 'high',
      agent_role_prompt:
        '关注：正确性 > 边界情况 > 复杂度 > 惯用风格。\n心里跑一遍代码，检查 bug。\n意见不一致时，给出能复现的例子说明谁对。\n',
      enhancer_focus: '确认：语言/版本、运行环境、现有架构约束、性能要求。\n',
      output_format: 'markdown_with_code_blocks',
    },
    research: {
      description: '深度调研 / 综述 / 跨源对比',
      models: ['claude', 'gemini', 'codex'],
      min_rounds: 3,
      max_rounds: 5,
      convergence_strictness: 'medium',
      required_capabilities: ['web_search'],
      effort: 'high',
      agent_role_prompt:
        '区分已确立事实与解释/推测。引用源头。\n争议性结论并列不同 camp 的代表性观点。\n',
      enhancer_focus: '确认：时间范围、深度（科普/学术）、目标受众、对比角度。\n',
      output_format: 'markdown_with_citations',
    },
    decision: {
      description: '决策辅助 / 战略选择 / 利弊权衡',
      models: ['claude', 'codex', 'gemini'],
      min_rounds: 4,
      max_rounds: 6,
      convergence_strictness: 'loose',
      required_capabilities: [],
      effort: 'high',
      agent_role_prompt:
        '显式列出 tradeoffs。挑战他人的隐含假设。\n避免"中立综合"——明确给出推荐 + confidence + 推荐失效条件。\n',
      enhancer_focus: '确认：选项空间、权衡偏好、硬约束、决策视野（短/长）、可接受风险。\n',
      output_format: 'markdown_with_pros_cons',
    },
    creative: {
      description: '创意写作 / 文案 / 头脑风暴',
      models: ['claude', 'codex', 'gemini'],
      min_rounds: 2,
      max_rounds: 3,
      convergence_strictness: 'loose',
      required_capabilities: [],
      effort: 'low',
      agent_role_prompt:
        '互相建立在对方优点上，不只是 critique。\n保留各家的独特火花。最终版不要稀释到平均水准。\n',
      enhancer_focus: '确认：目标受众、调性、长度、用途。\n',
      output_format: 'markdown',
    },
    reasoning: {
      description: '逻辑推理 / 数学 / 因果分析',
      models: ['claude', 'codex', 'gemini'],
      min_rounds: 3,
      max_rounds: 5,
      convergence_strictness: 'strict',
      required_capabilities: [],
      effort: 'high',
      agent_role_prompt:
        '显式 show work。每一步要可验证。\n不一致时找最小反例 / 最小可验证子结论。\n',
      enhancer_focus: '确认：已知前提、要求的严谨度、是否需要形式化证明。\n',
      output_format: 'markdown_with_stepped_reasoning',
    },
  },
};

/** v1 内置 scene 名单（用于 wizard / config CLI / Enhancer prompt 拼装）。 */
export const BUILTIN_SCENE_NAMES = Object.keys(BUILTIN_SCENES.scenes);

/** 是否是 v1 内置 scene。 */
export function isBuiltinScene(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_SCENES.scenes, name);
}
