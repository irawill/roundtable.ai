/**
 * 多语言模块共享类型。
 *
 * 来自 §language-support "三层语言概念" + "输出语言三层优先级（值域简化）" +
 * "持久化字段" + 跨阶段约束 #12。
 */

/**
 * requested_output_language 取值（用户层表达）。
 *
 * - 'auto'：由 Enhancer 检测
 * - 'system'：跟随 system_language
 * - 显式 BCP-47：如 'zh-Hans' / 'en' / 'ja'
 */
export type RequestedOutputLanguage = 'auto' | 'system' | string;

/**
 * 语言来源枚举（meta.json.language.source 写入此值）。
 *
 * 6 个值（来自 §language-support "输出语言三层优先级" + "单 agent 直通的语言解析"）：
 */
export type LanguageSource =
  | 'cli_override' // 来自 --lang 显式 BCP-47 / system
  | 'user_pref' // 来自 prefs.yaml.language.output 显式 BCP-47 / system
  | 'auto_detected' // requested=auto 时 Enhancer 检测成功（confidence >= 0.6）
  | 'low_confidence_system_confirmed' // requested=auto 时 confidence < 0.6 用 system_language 用户确认
  | 'fallback_heuristic' // requested=auto 时 Enhancer 完全失败，CJK 启发式 → 系统语言
  | 'single_agent_system_default'; // 单 agent direct 路径专属：requested=auto + 不调 Enhancer

/**
 * 全局解析后的语言状态（贯穿整个 run；进入 round loop 前由 Orchestrator 持有）。
 *
 * resolved_*_language 一旦确定，run 内**不可变**（来自 §language-support "三层语言概念"
 * "resolved 不可变" Scenario）。
 */
export interface LanguageState {
  /** 启动时立即推导，无 LLM 依赖（详见 §language-support "系统语言作为默认锚点"） */
  system: string;
  /** 用户表达层（CLI flag 或 prefs.output 字面值） */
  requested_output: RequestedOutputLanguage;
  /** 最终输出语言（永远是显式 BCP-47） */
  resolved_output: string;
  /** 最终 UI 语言（永远是显式 BCP-47） */
  resolved_ui: string;
  /** 输出语言来源（6 个枚举值之一） */
  source: LanguageSource;
  /** 检测置信度（仅 auto / low_confidence_system_confirmed / fallback_heuristic 有值） */
  confidence: number | null;
  /** 是否走过 fallback（auto 模式下 Enhancer 完全失败） */
  fallback_used: boolean;
}

/**
 * 早期渲染状态：TUI / wizard 在 Enhancer 调用前用此 UI 语言；
 * Enhancer 完成后 LanguageState 的 resolved_ui 会回填覆盖（详见 §language-support
 * "UI 语言解析" 中 match_output + auto 的回填条款）。
 */
export interface ProvisionalLanguageState {
  system: string;
  requested_output: RequestedOutputLanguage;
  /** 启动时的初步 UI 语言（用于 TUI / wizard 早期渲染） */
  provisional_ui: string;
}
