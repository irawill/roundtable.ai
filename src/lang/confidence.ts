import { getPackMeta } from '../shared/lang/packs.js';

/**
 * language_confidence 阈值确认。
 *
 * 来自 §language-support "language_confidence 阈值与确认" Requirement
 * + tasks.md §16.12。
 *
 * 触发条件：requested_output_language == 'auto' && Enhancer 返回的 language_confidence < 0.6。
 *
 * 处理：
 * 1. resolved_output_language = system_language（**不**用 prefs.yaml.language.fallback——
 *    系统语言更准；spec 已修正这条决策）
 * 2. 在反问中**用 system_language** 确认一次：「检测到混合语言输入，将以 {system_language 显示名}
 *    作答。需要其他语言请用 --lang=<tag> 重启。是否继续？(Y/n)」
 * 3. 用户拒绝 → 退出
 * 4. 用户确认 → meta.json.language.source = 'low_confidence_system_confirmed'
 *    + confidence 字段记录实际返回值
 *
 * 本模块仅产出"是否需要确认"判定 + "确认提示文案"；用户交互（TUI / stdin）在阶段 6 / 7 落地。
 */

export const LANGUAGE_CONFIDENCE_THRESHOLD = 0.6;

/**
 * 判定是否需要 system_language 确认。
 *
 * 仅 confidence < 0.6 时返回 true。
 */
export function needsLanguageConfirmation(confidence: number): boolean {
  return confidence < LANGUAGE_CONFIDENCE_THRESHOLD;
}

/**
 * 构造 system_language 确认提示文案。
 *
 * @param systemLang  系统语言 BCP-47
 * @returns 提示字符串（用 system_language 显示）；调用方负责把字符串显示到 TUI / stderr
 *
 * 注：v1 简化——提示文案永远用**英文 + 系统语言显示名**的格式（避免对每种 system_language
 * 都翻译 prompt 文案；翻译包 community 标签也涵盖不全）。中文 system_language 时仍可读。
 */
export function buildConfirmationPrompt(systemLang: string): string {
  const displayName = getPackMeta(systemLang)?.name ?? systemLang;
  return `检测到混合语言输入，将以 ${displayName} (${systemLang}) 作答。\n如需其他语言请用 \`--lang=<tag>\` 重启。是否继续？(Y/n)`;
}
