/**
 * i18n 翻译包加载器。
 *
 * 来自 §language-support "v1 内置 10 个翻译包" Requirement：
 * - 编译进二进制，不走运行时下载
 * - 10 个包：en / zh-Hans（verified）+ zh-Hant / ja / ko / es / fr / de / pt-BR / ru（community）
 * - 缺失 key fallback 到 en（基准 / 所有缺失 key 的 fallback 锚点）
 * - 缺失整个翻译包（如用户用 vi）→ 调用方按 prefs.yaml.language.fallback 走（默认 en）
 *
 * 编译方式：通过静态 import 把 10 个 JSON 文件 inline 进 bundle（tsup 配置 .json loader）。
 */

import enPack from '../../i18n/en.json' with { type: 'json' };
import zhHansPack from '../../i18n/zh-Hans.json' with { type: 'json' };
import zhHantPack from '../../i18n/zh-Hant.json' with { type: 'json' };
import jaPack from '../../i18n/ja.json' with { type: 'json' };
import koPack from '../../i18n/ko.json' with { type: 'json' };
import esPack from '../../i18n/es.json' with { type: 'json' };
import frPack from '../../i18n/fr.json' with { type: 'json' };
import dePack from '../../i18n/de.json' with { type: 'json' };
import ptBrPack from '../../i18n/pt-BR.json' with { type: 'json' };
import ruPack from '../../i18n/ru.json' with { type: 'json' };

/** 翻译包元信息（每个 JSON 文件顶部的 $meta 段）。 */
export interface PackMeta {
  language: string;
  name: string;
  quality: 'verified' | 'community';
}

/** 翻译包：除 $meta 外其余 key → 翻译字符串。 */
export interface TranslationPack {
  $meta: PackMeta;
  [key: string]: string | PackMeta;
}

/** v1 内置 10 个翻译包（按 §language-support 列表）。 */
const BUILTIN_PACKS: ReadonlyMap<string, TranslationPack> = new Map([
  ['en', enPack as unknown as TranslationPack],
  ['zh-Hans', zhHansPack as unknown as TranslationPack],
  ['zh-Hant', zhHantPack as unknown as TranslationPack],
  ['ja', jaPack as unknown as TranslationPack],
  ['ko', koPack as unknown as TranslationPack],
  ['es', esPack as unknown as TranslationPack],
  ['fr', frPack as unknown as TranslationPack],
  ['de', dePack as unknown as TranslationPack],
  ['pt-BR', ptBrPack as unknown as TranslationPack],
  ['ru', ruPack as unknown as TranslationPack],
]);

/** 列出全部内置翻译包语言 tag（按声明顺序）。 */
export function listBuiltinLanguages(): readonly string[] {
  return Array.from(BUILTIN_PACKS.keys());
}

/** 是否内置该语言。 */
export function hasBuiltinPack(tag: string): boolean {
  return BUILTIN_PACKS.has(tag);
}

/**
 * 取指定语言的翻译包元信息（含 quality 标签）。
 * 不存在则返回 undefined。
 */
export function getPackMeta(tag: string): PackMeta | undefined {
  const pack = BUILTIN_PACKS.get(tag);
  return pack ? pack.$meta : undefined;
}

/**
 * 翻译查询主入口。
 *
 * 流程：
 * 1. 在目标语言包中查 key
 * 2. 命中且为字符串 → 处理 placeholder（{name} 替换为 params[name]）→ 返回
 * 3. 未命中 → fallback 到 en 包查 key
 * 4. 仍未命中 → 返回 key 本身（便于 dev 时立即看到缺失）；可选 dev warn
 *
 * @param tag    目标语言 BCP-47（如 zh-Hans / ja）；不存在的语言会直接走 en fallback
 * @param key    翻译 key（如 "finalizer.section.consensus"）
 * @param params 可选 placeholder 参数
 */
export function t(tag: string, key: string, params: Record<string, string> = {}): string {
  const primary = BUILTIN_PACKS.get(tag);
  const primaryHit = primary?.[key];
  if (typeof primaryHit === 'string') return interpolate(primaryHit, params);

  // Fallback：en 包
  if (tag !== 'en') {
    const fallback = BUILTIN_PACKS.get('en');
    const fallbackHit = fallback?.[key];
    if (typeof fallbackHit === 'string') {
      if (process.env.RTAI_DEBUG_I18N === '1') {
        // eslint-disable-next-line no-console
        console.error(`[i18n] missing key "${key}" in "${tag}", fell back to "en"`);
      }
      return interpolate(fallbackHit, params);
    }
  }

  // 完全缺失：返回 key（便于 dev 立刻看到漏译）
  if (process.env.RTAI_DEBUG_I18N === '1') {
    // eslint-disable-next-line no-console
    console.error(`[i18n] missing key "${key}" in "${tag}" and "en" fallback`);
  }
  return key;
}

/** 简单 placeholder 替换：把 "{name}" 替换为 params[name]。 */
function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? params[name]! : match;
  });
}
