import { fallbackHeuristicLanguage } from '../lang/heuristic.js';
import type { LanguageState, LanguageSource, RequestedOutputLanguage } from '../lang/types.js';

/**
 * Enhancer 完全失败 fallback。
 *
 * 来自 §question-enhancer "Enhancer 失败 fallback（完整状态机路径）" + §language-support
 * "Enhancer 完全失败时的语言处理" + tasks.md §7.6 / §16.11。
 *
 * 触发：adapter ERRORED / JSON parse 重试后仍失败 / timeout。
 *
 * 处理（按 requested_output_language 分流）：
 * 1. 跳过 enhancement：enhanced_question = raw_question（无补全 / 反问）
 * 2. 使用 general scene + scene_source = fallback_general（或上游已设的 cli_override）
 * 3. 语言：
 *    - requested == 'auto' → CJK 启发式（首 200 字 CJK ≥ 50% → 'zh-Hans'，否则 system_language）
 *      → source = 'fallback_heuristic'
 *    - 'system' 或显式 BCP-47 → 保留调用前已 resolved 的 source（cli_override / user_pref），
 *      **不**改走启发式
 *
 * 调用方：Orchestrator 在 adapter / parse 失败 catch 中调用本函数；本函数**不**触发用户确认页
 * （那是阶段 5 / 6 状态机层的事），只返回 fallback 结果。
 */

export interface EnhancerFallbackResult {
  /** 等于 raw_question */
  enhanced_question: string;
  /** 失败原因（写入 meta.json.enhancer.failure_reason） */
  failure_reason: 'adapter_errored' | 'json_parse_failed' | 'timeout';
  /** fallback 后的 language 状态（含可能更新的 resolved_output + source + fallback_used=true） */
  language: LanguageState;
  /** 是否启用了启发式（auto 模式 + 完全失败） */
  heuristic_applied: boolean;
}

export interface EnhancerFallbackArgs {
  rawQuestion: string;
  requestedOutput: RequestedOutputLanguage;
  /** 调用 Enhancer 前已 resolved 的 language（explicit 模式下保留） */
  preResolvedLanguage: LanguageState;
  failureReason: 'adapter_errored' | 'json_parse_failed' | 'timeout';
}

export function applyEnhancerFailureFallback(args: EnhancerFallbackArgs): EnhancerFallbackResult {
  // 语言处理分流
  let language: LanguageState;
  let heuristicApplied = false;
  if (args.requestedOutput === 'auto') {
    const heuristicLang = fallbackHeuristicLanguage({
      rawQuestion: args.rawQuestion,
      systemLang: args.preResolvedLanguage.system,
    });
    heuristicApplied = true;
    language = {
      ...args.preResolvedLanguage,
      resolved_output: heuristicLang,
      source: 'fallback_heuristic' satisfies LanguageSource,
      confidence: null,
      fallback_used: true,
    };
  } else {
    // explicit / system 模式：保留已 resolved 的语言（source 不变）
    language = {
      ...args.preResolvedLanguage,
      fallback_used: true,
    };
  }

  return {
    enhanced_question: args.rawQuestion,
    failure_reason: args.failureReason,
    language,
    heuristic_applied: heuristicApplied,
  };
}
