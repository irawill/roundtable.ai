import { isValidBcp47, normalizeBcp47 } from '../shared/lang/bcp47.js';
import { resolveLang } from '../shared/lang/alias.js';
import type { LanguageSource, RequestedOutputLanguage } from './types.js';

/**
 * Output 语言解析器。
 *
 * 来自 §language-support "输出语言三层优先级（值域简化）" + "三层语言概念"
 * + "单 agent 直通的语言解析" + tasks.md §16.4 / §16.5。
 *
 * 解析链：
 * 1. parseRequestedOutputLanguage(rawCli, rawPref) → RequestedOutputLanguage + 来源标记
 * 2. resolveOutputLanguage({requested, systemLang, mode, ...}) → 最终 BCP-47 + source
 *    - explicit 模式（'system' 或 BCP-47）：调用前可直接 resolve
 *    - auto 模式：由 Enhancer 检测填回；本模块提供 resolveOutputFromAutoDetected 辅助函数
 *    - 单 agent direct 模式：调用 resolveOutputForSingleAgentDirect → source=single_agent_system_default
 */

/** parseRequestedOutputLanguage 的解析结果。 */
export interface ParsedRequest {
  /** 用户层表达：'auto' / 'system' / 显式 BCP-47 */
  value: RequestedOutputLanguage;
  /** 来源：cli_override（来自 CLI flag）或 user_pref（来自 prefs.yaml） */
  origin: 'cli_override' | 'user_pref';
}

/**
 * 按 CLI flag &gt; prefs.output 顺序解析 requested_output_language。
 *
 * @param cliRaw  --lang 的原始字符串（可能是别名 / BCP-47 / 关键字）；undefined 表示未传
 * @param prefRaw prefs.yaml.language.output 的原始字符串（默认 'auto'）
 *
 * 处理：
 * - CLI flag 优先；先走 alias 表 normalize（含关键字 auto/system）
 * - CLI flag 非法 → throw（启动报错；调用方决定如何呈现）
 * - CLI flag 未传 → 按 prefs.output normalize；非法则按 §language-support "非法值" 走 fallback 到 auto
 *   + warn（本函数返回 fallback 后的合法值与 warning 文本，由调用方决定如何 emit）
 */
export function parseRequestedOutputLanguage(args: {
  cliRaw?: string;
  prefRaw: string;
}): { request: ParsedRequest; warning?: string } {
  if (args.cliRaw !== undefined) {
    const resolved = resolveLang(args.cliRaw);
    if (resolved.kind === 'invalid') {
      throw new LangResolverError(
        `--lang 非法值 "${args.cliRaw}"；运行 \`rtai config language list\` 查看合法值`,
      );
    }
    return {
      request: {
        value: resolved.kind === 'keyword' ? resolved.value : resolved.value,
        origin: 'cli_override',
      },
    };
  }

  const resolved = resolveLang(args.prefRaw);
  if (resolved.kind === 'invalid') {
    return {
      request: { value: 'auto', origin: 'user_pref' },
      warning: `prefs.yaml.language.output "${args.prefRaw}" 非法，已 fallback 到 auto`,
    };
  }
  return {
    request: {
      value: resolved.kind === 'keyword' ? resolved.value : resolved.value,
      origin: 'user_pref',
    },
  };
}

/**
 * Explicit 模式（requested 非 'auto'）直接解析 resolved_output_language。
 *
 * - 'system' → systemLang
 * - 显式 BCP-47 → 该值
 *
 * @throws LangResolverError 如果 requested 是 'auto'（调用方使用错误的入口；auto 模式需走 Enhancer）
 */
export function resolveExplicitOutput(args: {
  request: ParsedRequest;
  systemLang: string;
}): { resolved: string; source: LanguageSource } {
  if (args.request.value === 'auto') {
    throw new LangResolverError(
      'resolveExplicitOutput 不能用于 auto 模式；auto 模式由 Enhancer 检测填回',
    );
  }
  const resolved =
    args.request.value === 'system' ? args.systemLang : normalizeBcp47(args.request.value);
  return { resolved, source: args.request.origin };
}

/**
 * Auto 模式 + Enhancer 检测成功 → 解析 resolved_output_language。
 *
 * 来自 §language-support "language_confidence 阈值与确认"：
 * - confidence &gt;= 0.6 → 用 detected_language；source = auto_detected
 * - confidence &lt; 0.6 → 触发 system_language 确认流程（由调用方处理交互）；
 *   本函数返回 confirmation_needed 标记 + 推荐 fallback 到 systemLang
 */
export function resolveAutoOutput(args: {
  detectedLanguage: string;
  confidence: number;
  systemLang: string;
}): { resolved: string; source: LanguageSource; needsSystemConfirmation: boolean } {
  if (args.confidence >= 0.6) {
    return {
      resolved: isValidBcp47(args.detectedLanguage)
        ? normalizeBcp47(args.detectedLanguage)
        : args.systemLang,
      source: 'auto_detected',
      needsSystemConfirmation: false,
    };
  }
  // 置信度低 → 推荐 fallback 到 system_language，但需用户确认
  return {
    resolved: args.systemLang,
    source: 'low_confidence_system_confirmed',
    needsSystemConfirmation: true,
  };
}

/**
 * 单 agent direct 路径：requested=auto 时直接走 system_language，不调 Enhancer。
 *
 * 来自 §language-support "单 agent 直通的语言解析" Requirement：
 * - source = single_agent_system_default（**专属枚举值**，与 user_pref / fallback_heuristic 区分）
 */
export function resolveOutputForSingleAgentDirect(args: {
  request: ParsedRequest;
  systemLang: string;
}): { resolved: string; source: LanguageSource } {
  if (args.request.value === 'auto') {
    return {
      resolved: args.systemLang,
      source: 'single_agent_system_default',
    };
  }
  // 显式 / system → 同 explicit 模式
  return resolveExplicitOutput(args);
}

export class LangResolverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LangResolverError';
  }
}
