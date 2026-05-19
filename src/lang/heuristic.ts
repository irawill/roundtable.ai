/**
 * CJK 字符占比启发式（Enhancer 完全失败时的语言 fallback）。
 *
 * 来自 §language-support "Enhancer 完全失败时的语言处理" + §question-enhancer
 * "Enhancer 失败 fallback（完整状态机路径）" + tasks.md §16.11 / §7.6。
 *
 * 触发条件：requested_output_language == 'auto' && Enhancer 完全失败（adapter ERRORED /
 * parse 失败 / timeout）。
 *
 * 规则：
 * - 取原始问题前 200 字符
 * - CJK 字符占比 ≥ 50% → 'zh-Hans'
 * - 否则 → system_language
 *
 * **注意**：explicit 模式（requested 是 'system' 或显式 BCP-47）**不**走启发式；
 * Enhancer 失败时保留已 resolved 的语言与 source。本函数仅由 enhancerFailureFallback 调用。
 *
 * CJK 范围（U+3000 - U+9FFF + U+3400-4DBF 扩展 A + U+20000-2A6DF 扩展 B 等，v1 简化只看 BMP 基本区）：
 * - U+3000..U+303F：CJK 符号与标点
 * - U+3040..U+309F：日文平假名
 * - U+30A0..U+30FF：日文片假名
 * - U+3400..U+4DBF：CJK 扩展 A
 * - U+4E00..U+9FFF：CJK 统一表意（含简繁中文）
 * - U+AC00..U+D7AF：朝鲜文音节
 * - U+FF00..U+FFEF：半角全角字符（含中文全角标点）
 */

const CJK_PEEK_LENGTH = 200;
const CJK_THRESHOLD = 0.5;

/**
 * 判断原始问题是否主要为 CJK。
 *
 * @param rawQuestion  用户原始问题
 * @returns true 表示 CJK 占比 ≥ 50%（建议 fallback 到 zh-Hans）
 */
export function isMostlyCjk(rawQuestion: string): boolean {
  return computeCjkRatio(rawQuestion) >= CJK_THRESHOLD;
}

/**
 * 计算 CJK 字符占比（前 200 字符内）。便于测试 + 调试。
 *
 * 分母排除空白字符（避免 "  汉  " 占比偏低）。
 */
export function computeCjkRatio(rawQuestion: string): number {
  const peek = Array.from(rawQuestion).slice(0, CJK_PEEK_LENGTH).join('');
  let total = 0;
  let cjk = 0;
  for (const ch of peek) {
    if (/\s/.test(ch)) continue;
    total++;
    if (isCjkChar(ch.codePointAt(0)!)) cjk++;
  }
  if (total === 0) return 0;
  return cjk / total;
}

function isCjkChar(cp: number): boolean {
  return (
    (cp >= 0x3000 && cp <= 0x303f) ||
    (cp >= 0x3040 && cp <= 0x309f) ||
    (cp >= 0x30a0 && cp <= 0x30ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xac00 && cp <= 0xd7af) ||
    (cp >= 0xff00 && cp <= 0xffef)
  );
}

/**
 * Enhancer 完全失败时的语言 fallback 主入口（auto 模式专用）。
 *
 * @returns
 * - 若 CJK 占比 ≥ 50% → 'zh-Hans'
 * - 否则 → systemLang
 */
export function fallbackHeuristicLanguage(args: {
  rawQuestion: string;
  systemLang: string;
}): string {
  return isMostlyCjk(args.rawQuestion) ? 'zh-Hans' : args.systemLang;
}
