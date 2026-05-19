/**
 * BCP-47 语言标签校验。
 *
 * 来自 §language-support "Alias 解析表" 与 "prefs.yaml 存储格式"：output / ui 显式 BCP-47 MUST 是
 * canonical 形式（如 zh-Hans）。不在 alias 表的输入 SHALL 当 BCP-47 校验；通过则直接用，失败报错。
 *
 * v1 不实现完整的 IANA Language Subtag Registry；仅做语法层面校验：
 * - language subtag：2-3 字母（ISO 639-1 / 639-2/3 主流活语言）；5-8 字母的"已注册"子标签实际罕见，
 *   v1 暂不接受（与 §language-support "非法输入" Scenario 一致——`xxxxxx` 视为非法）
 * - 可选 script subtag：4 字母（如 Hans / Hant / Latn / Cyrl）
 * - 可选 region subtag：2 字母 ISO 3166-1 或 3 数字 UN M.49
 * - 可选 variant / extension / private-use 暂不深入校验（避免误拒合法输入）
 *
 * 关键字 auto / system MUST NOT 通过本函数校验（它们由调用方在更上层判断）。
 */

const BCP47_REGEX = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?(?:-[A-Za-z0-9]{5,8})*$/;

export function isValidBcp47(tag: string): boolean {
  if (tag.length === 0) return false;
  // 关键字保护：调用方不应把 auto / system 送进来；这里直接拒绝
  if (tag === 'auto' || tag === 'system') return false;
  return BCP47_REGEX.test(tag);
}

/**
 * 把可能含大小写差异的 BCP-47 标签 normalize 为 canonical：
 * - language subtag：小写
 * - script subtag：首字母大写（4 字母）
 * - region subtag：大写（2 字母）/ 数字保留
 * - variant 等保留原样
 *
 * 注：本函数不校验合法性；非合法 BCP-47 字符串可能产生意外结果。调用方应先 isValidBcp47 检查。
 */
export function normalizeBcp47(tag: string): string {
  return tag
    .split('-')
    .map((part, idx) => {
      if (idx === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/.test(part)) {
        // script subtag：首字母大写
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      }
      if (/^[A-Za-z]{2}$/.test(part)) {
        // region subtag (alpha)：大写
        return part.toUpperCase();
      }
      // 数字 region (UN M.49) 或其他 subtag 保留
      return part;
    })
    .join('-');
}
