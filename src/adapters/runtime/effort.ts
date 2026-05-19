import type { EffortLevel } from '../../shared/adapter.js';
import { EFFORT_LEVELS } from '../../config/effort.js';

/**
 * effort_mapping 翻译器。
 *
 * 来自 §effort-control "Adapter 提供 effort_mapping" + tasks.md §4.4。
 *
 * 把 5 级 abstraction（none / low / medium / high / max）映射到 CLI 的具体 flag 数组：
 *
 *   effort_mapping:
 *     none:   []                     # 空数组 = 不加 flag
 *     low:    ["--effort", "low"]
 *     medium: ["--effort", "medium"]
 *     high:   ["--effort", "high"]
 *     max:    ["--effort", "max"]
 *
 * 兼容情形：
 * - 未在 effort_mapping 中声明的 level → 取最接近的已声明 level + warn（详见 spec
 *   §effort-control "Adapter 提供 effort_mapping" Scenario "model 不支持 max"）
 * - 全部 effort_mapping 为 [] / 全部缺省（如 Haiku 无 reasoning 能力） → 任何 level 都返回 []，不 warn
 * - 完全缺省 effort_mapping（{}） → 任何 level 都返回 []，且不 warn（视为 model 完全不支持 effort
 *   flag，等价"reasoning 能力 = 0"，spec §effort-control "不支持 effort 的 model 静默忽略"）
 */

/** EffortMapping 接受 partial（缺失 level 视为该 model 不支持）。 */
export type EffortMapping = Partial<Record<EffortLevel, readonly string[]>>;

export interface TranslateEffortResult {
  /** 翻译后的 CLI flag 数组（可为空） */
  flags: string[];
  /** 实际使用的 level（可能因 fallback 与请求不同） */
  effectiveLevel: EffortLevel;
  /** 是否发生了 fallback（请求 level 不在 mapping，取最接近） */
  fellBack: boolean;
  /** 仅 fellBack=true 时填充：原始请求的 level */
  requestedLevel?: EffortLevel;
  /** warn 文案（fallback 时填充） */
  warning?: string;
}

/**
 * 翻译 effort level 到 CLI flag 数组。
 *
 * @param mapping  models.yaml.<name>.effort_mapping
 * @param requested  本次实际使用的 effort（来自 §effort-control 4 层解析后的结果）
 */
export function translateEffort(
  mapping: EffortMapping,
  requested: EffortLevel,
): TranslateEffortResult {
  // 直接命中
  const direct = mapping[requested];
  if (direct !== undefined) {
    return {
      flags: [...direct],
      effectiveLevel: requested,
      fellBack: false,
    };
  }

  // 全部缺省（即 model 完全不支持 effort 等级，如 Haiku / Flash 类）
  // 静默返回 [] + level 视为请求值
  const declared = (Object.keys(mapping) as EffortLevel[]).filter((k) => mapping[k] !== undefined);
  if (declared.length === 0) {
    return {
      flags: [],
      effectiveLevel: requested,
      fellBack: false,
    };
  }

  // 部分缺省：找最接近已声明 level
  const fallback = pickClosestLevel(declared, requested);
  return {
    flags: [...(mapping[fallback] ?? [])],
    effectiveLevel: fallback,
    fellBack: true,
    requestedLevel: requested,
    warning: `effort_mapping 中无 "${requested}" 等级，已 fallback 到最接近的 "${fallback}"`,
  };
}

/** 在已声明 level 集合中找最接近 target 的（按 EFFORT_LEVELS 索引距离）。 */
function pickClosestLevel(declared: EffortLevel[], target: EffortLevel): EffortLevel {
  const targetIdx = EFFORT_LEVELS.indexOf(target);
  let best: EffortLevel = declared[0]!;
  let bestDist = Math.abs(EFFORT_LEVELS.indexOf(best) - targetIdx);
  for (let i = 1; i < declared.length; i++) {
    const cand = declared[i]!;
    const dist = Math.abs(EFFORT_LEVELS.indexOf(cand) - targetIdx);
    if (
      dist < bestDist ||
      // 同距离时优先取序数更低的（保守选择，避免意外升级到 max）
      (dist === bestDist && EFFORT_LEVELS.indexOf(cand) < EFFORT_LEVELS.indexOf(best))
    ) {
      best = cand;
      bestDist = dist;
    }
  }
  return best;
}
