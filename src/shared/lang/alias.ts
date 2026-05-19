/**
 * 语言 alias 解析表。
 *
 * 来自 §language-support "Alias 解析表" Requirement：
 * - CLI --lang 与 rtai config language set 接受用户大概率会输入的别名形式
 * - normalize 到 canonical BCP-47 或保留语义关键字（auto / system）
 * - alias 表 MUST 至少包含 25 条主流条目
 * - 关键字 auto / system MUST NOT 被任何 alias 表项覆盖
 *
 * 不在表内的输入 SHALL 当 BCP-47 校验（由调用方负责）；通过则直接用，失败报错。
 */

import { isValidBcp47, normalizeBcp47 } from './bcp47.js';

/** 关键字：保留语义不进 alias 表，调用方需先识别。 */
export const RESERVED_KEYWORDS = new Set(['auto', 'system'] as const);

export type LangResolution =
  | { kind: 'keyword'; value: 'auto' | 'system' }
  | { kind: 'bcp47'; value: string }
  | { kind: 'invalid'; raw: string };

/**
 * Alias 表（小写 key → canonical BCP-47）。
 *
 * 包含 v1 内置 10 个翻译包 + 主流别名 / 显示名 / 母语自称。
 * 共 ≥ 25 条；关键字 auto / system MUST NOT 出现在本表（已在调用方拦截）。
 */
const ALIAS_TABLE: ReadonlyMap<string, string> = new Map([
  // 简体中文
  ['zh', 'zh-Hans'],
  ['cn', 'zh-Hans'],
  ['chinese', 'zh-Hans'],
  ['simplified-chinese', 'zh-Hans'],
  ['zh-cn', 'zh-Hans'],
  ['zh_cn', 'zh-Hans'],
  ['zh-hans', 'zh-Hans'],
  ['中文', 'zh-Hans'],
  ['简体', 'zh-Hans'],
  ['简中', 'zh-Hans'],
  ['简体中文', 'zh-Hans'],

  // 繁体中文
  ['tw', 'zh-Hant'],
  ['zh-tw', 'zh-Hant'],
  ['zh_tw', 'zh-Hant'],
  ['zh-hant', 'zh-Hant'],
  ['traditional-chinese', 'zh-Hant'],
  ['繁体', 'zh-Hant'],
  ['繁中', 'zh-Hant'],
  ['繁體', 'zh-Hant'],
  ['繁體中文', 'zh-Hant'],

  // 日语
  ['jp', 'ja'],
  ['japanese', 'ja'],
  ['日本語', 'ja'],
  ['日语', 'ja'],
  ['日文', 'ja'],

  // 韩语
  ['kr', 'ko'],
  ['korean', 'ko'],
  ['한국어', 'ko'],
  ['韩语', 'ko'],
  ['韓語', 'ko'],

  // 英语
  ['english', 'en'],
  ['英语', 'en'],
  ['英文', 'en'],
  ['en-us', 'en'],
  ['en_us', 'en'],
  ['en-gb', 'en'],

  // 西班牙语
  ['spanish', 'es'],
  ['español', 'es'],
  ['西班牙语', 'es'],

  // 法语
  ['french', 'fr'],
  ['français', 'fr'],
  ['法语', 'fr'],

  // 德语
  ['german', 'de'],
  ['deutsch', 'de'],
  ['德语', 'de'],

  // 葡萄牙语（巴西）
  ['pt-br', 'pt-BR'],
  ['pt_br', 'pt-BR'],
  ['brazilian-portuguese', 'pt-BR'],
  ['português-br', 'pt-BR'],
  ['葡萄牙语', 'pt-BR'],

  // 俄语
  ['russian', 'ru'],
  ['русский', 'ru'],
  ['俄语', 'ru'],
]);

/**
 * 解析用户输入的语言字符串。
 *
 * 返回三种结果：
 * - keyword: auto / system（保留关键字，调用方按上下文展开）
 * - bcp47: canonical BCP-47 字符串（来自 alias 表 normalize 或直接 BCP-47 校验通过）
 * - invalid: 既不是关键字、又不在 alias 表、又不是合法 BCP-47
 *
 * 注：本函数对大小写不敏感（先 lowercase 查表）；BCP-47 校验失败时尝试 normalize 后重试一次
 * （便于用户输入 "EN" / "Zh-hans" 等大小写不标准但语义合法的形式）。
 */
export function resolveLang(rawInput: string): LangResolution {
  const trimmed = rawInput.trim();
  if (trimmed === '') return { kind: 'invalid', raw: rawInput };

  const lower = trimmed.toLowerCase();

  // 关键字（保留语义，不进 alias 表）
  if (lower === 'auto') return { kind: 'keyword', value: 'auto' };
  if (lower === 'system') return { kind: 'keyword', value: 'system' };

  // Alias 表
  const aliasHit = ALIAS_TABLE.get(lower);
  if (aliasHit !== undefined) return { kind: 'bcp47', value: aliasHit };

  // 直接 BCP-47 校验
  if (isValidBcp47(trimmed)) return { kind: 'bcp47', value: normalizeBcp47(trimmed) };
  // 大小写不标准但 normalize 后合法的情形
  const normalized = normalizeBcp47(trimmed);
  if (isValidBcp47(normalized)) return { kind: 'bcp47', value: normalized };

  return { kind: 'invalid', raw: rawInput };
}

/** 仅测试 / 文档用：列出全部 alias key 数量（应 ≥ 25）。 */
export function aliasEntryCount(): number {
  return ALIAS_TABLE.size;
}
