import { resolveLang } from '../shared/lang/alias.js';
import { normalizeBcp47 } from '../shared/lang/bcp47.js';
import { hasBuiltinPack } from '../shared/lang/packs.js';
import type { LanguageState, RequestedOutputLanguage } from './types.js';

/**
 * UI 语言解析器。
 *
 * 来自 §language-support "UI 语言解析" Requirement + tasks.md §16.6 / §16.7。
 *
 * 三层概念：
 * - **provisional_ui_language**：启动时立即可用（TUI / wizard 早期渲染）；不依赖 LLM
 * - **resolved_ui_language**：最终值；大多数情况 = provisional；
 *   仅 `prefs.ui = match_output && prefs.output = auto` 时 Enhancer 完成后回填
 * - CLI flag `--ui-lang` 直接 override 两个值
 *
 * prefs.ui 取值：
 * - 'system' → system_language
 * - 'match_output' → 跟随 resolved_output_language（在 auto 模式下要等 Enhancer）
 * - 显式 BCP-47 → 该值
 *
 * 缺失翻译包时 fallback `prefs.yaml.language.fallback`（默认 'en'）+ warn。
 */

export interface ResolveProvisionalUiArgs {
  /** CLI --ui-lang 原始值（可能未传） */
  cliUiLangRaw?: string;
  /** prefs.yaml.language.ui 原始字符串 */
  prefUiRaw: string;
  /** 启动时已解析的 system_language */
  systemLang: string;
  /** prefs.yaml.language.output 原始字符串（'auto' / 'system' / BCP-47） */
  prefOutputRaw: string;
  /** prefs.yaml.language.fallback（用于翻译包缺失时 fallback） */
  fallbackLang: string;
}

export interface ProvisionalResolveResult {
  /** 启动时立即可用的 UI 语言（BCP-47） */
  provisional_ui: string;
  /**
   * 是否需要后续回填：仅 prefs.ui=match_output && prefs.output=auto 时为 true。
   * 此时 provisional_ui 暂用 system_language，Enhancer 完成后调用 finalizeUiLanguage 回填。
   */
  needsPostEnhancerFinalize: boolean;
  warnings: string[];
}

/**
 * 启动时立即解析 provisional_ui_language（不依赖 LLM）。
 *
 * 解析表（来自 §language-support "UI 语言解析"）：
 *
 *   prefs.ui 值                          provisional_ui_language
 *   'system'                             system_language
 *   显式 BCP-47                          该值
 *   'match_output' + prefs.output BCP-47 prefs.output 值
 *   'match_output' + prefs.output system system_language
 *   'match_output' + prefs.output auto   system_language（需后续回填）
 *
 * CLI --ui-lang 直接 override 两个值（不进入 match_output 分支）。
 */
export function resolveProvisionalUi(args: ResolveProvisionalUiArgs): ProvisionalResolveResult {
  const warnings: string[] = [];

  // CLI flag override
  if (args.cliUiLangRaw !== undefined) {
    const r = resolveLang(args.cliUiLangRaw);
    if (r.kind === 'bcp47') {
      const tag = normalizeBcp47(r.value);
      return {
        provisional_ui: ensurePackOrFallback(tag, args.fallbackLang, warnings),
        needsPostEnhancerFinalize: false,
        warnings,
      };
    }
    if (r.kind === 'keyword' && r.value === 'system') {
      return {
        provisional_ui: ensurePackOrFallback(args.systemLang, args.fallbackLang, warnings),
        needsPostEnhancerFinalize: false,
        warnings,
      };
    }
    // 关键字 auto 在 ui 不合法；keyword=auto 视为无效
    warnings.push(`--ui-lang 非法值 "${args.cliUiLangRaw}"，已忽略并按 prefs.ui 解析`);
  }

  // prefs.ui 解析
  const prefUi = args.prefUiRaw.trim();

  if (prefUi === 'system') {
    return {
      provisional_ui: ensurePackOrFallback(args.systemLang, args.fallbackLang, warnings),
      needsPostEnhancerFinalize: false,
      warnings,
    };
  }

  if (prefUi === 'match_output') {
    // 看 prefs.output 决定具体值
    const outputRequest = parseSimpleRequest(args.prefOutputRaw);
    if (outputRequest === 'auto') {
      return {
        provisional_ui: ensurePackOrFallback(args.systemLang, args.fallbackLang, warnings),
        needsPostEnhancerFinalize: true,
        warnings,
      };
    }
    if (outputRequest === 'system') {
      return {
        provisional_ui: ensurePackOrFallback(args.systemLang, args.fallbackLang, warnings),
        needsPostEnhancerFinalize: false,
        warnings,
      };
    }
    // 显式 BCP-47
    return {
      provisional_ui: ensurePackOrFallback(outputRequest, args.fallbackLang, warnings),
      needsPostEnhancerFinalize: false,
      warnings,
    };
  }

  // prefs.ui 显式 BCP-47
  const r = resolveLang(prefUi);
  if (r.kind === 'bcp47') {
    const tag = normalizeBcp47(r.value);
    return {
      provisional_ui: ensurePackOrFallback(tag, args.fallbackLang, warnings),
      needsPostEnhancerFinalize: false,
      warnings,
    };
  }

  // 非法 → fallback
  warnings.push(`prefs.yaml.language.ui "${prefUi}" 非法，已 fallback 到 system_language`);
  return {
    provisional_ui: ensurePackOrFallback(args.systemLang, args.fallbackLang, warnings),
    needsPostEnhancerFinalize: false,
    warnings,
  };
}

/**
 * Enhancer 完成后回填 resolved_ui_language。
 *
 * 来自 §language-support "UI 语言解析" 中 match_output + auto 的回填条款。
 *
 * 仅在 resolveProvisionalUi 返回 needsPostEnhancerFinalize=true 时调用；
 * 其他情况 resolved_ui = provisional_ui 即可。
 *
 * 注：TUI 在回填后 SHALL NOT 切换渲染语言（避免 run 中途 UI 闪烁），
 * 仅在 Finalizer 输出阶段使用更新后的 resolved_ui_language。
 */
export function finalizeUiLanguage(args: {
  provisional_ui: string;
  resolved_output: string;
  fallbackLang: string;
}): { resolved_ui: string; warnings: string[] } {
  const warnings: string[] = [];
  return {
    resolved_ui: ensurePackOrFallback(args.resolved_output, args.fallbackLang, warnings),
    warnings,
  };
}

/** 把已确定的 LanguageState 简化为常用字段（便于 Orchestrator 持有）。 */
export function packLanguageState(
  s: Omit<LanguageState, never>,
): LanguageState {
  return { ...s };
}

/** 检查翻译包是否内置；不在则 fallback 到 fallbackLang + warn。 */
function ensurePackOrFallback(tag: string, fallback: string, warnings: string[]): string {
  if (hasBuiltinPack(tag)) return tag;
  warnings.push(
    `v1 不内置 "${tag}" UI 翻译包，已 fallback 到 "${fallback}"；欢迎 GitHub PR 贡献翻译`,
  );
  return fallback;
}

/** 把 prefs.output 原始字符串简化为 'auto' / 'system' / BCP-47（用于 match_output 判定）。 */
function parseSimpleRequest(raw: string): RequestedOutputLanguage {
  const r = resolveLang(raw);
  if (r.kind === 'keyword') return r.value;
  if (r.kind === 'bcp47') return r.value;
  // 非法 → 视为 auto（保守 fallback）
  return 'auto';
}
