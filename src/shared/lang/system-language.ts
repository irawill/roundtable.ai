/**
 * 从 $LANG / $LC_ALL / $LC_MESSAGES env 推导 system_language（BCP-47）。
 *
 * 来自 §language-support "系统语言作为默认锚点" Requirement：
 * - 启动时立即可用，无 LLM 依赖
 * - TUI / wizard 早期渲染的语言锚点
 * - resolved_*_language 未确定前 provisional_ui_language 的来源
 *
 * 推导规则（按 spec）：
 * - zh_CN.UTF-8 / zh_SG.UTF-8 / zh_MY.UTF-8 → zh-Hans
 * - zh_TW.UTF-8 / zh_HK.UTF-8 / zh_MO.UTF-8 → zh-Hant
 * - ja_JP.UTF-8 → ja
 * - ko_KR.UTF-8 → ko
 * - en_US.UTF-8 / en_GB.UTF-8 / 等 → en
 * - es_ES / fr_FR / de_DE / pt_BR / ru_RU → 对应 BCP-47
 * - 不可识别或 $LANG 未设 → en
 *
 * 不可识别的 locale（如 vi_VN.UTF-8）仍记录为 BCP-47（vi），但 UI 翻译包 fallback 走
 * prefs.yaml.language.fallback（默认 en）——本模块不做翻译包查询，仅做 locale → BCP-47 推导。
 */

/** 输入：环境变量取值（可选 $LANG / $LC_ALL / $LC_MESSAGES）。 */
export interface EnvLocaleInput {
  LANG?: string | undefined;
  LC_ALL?: string | undefined;
  LC_MESSAGES?: string | undefined;
}

/**
 * 从 env 推导 system_language。优先级 LC_ALL > LC_MESSAGES > LANG（与 POSIX locale 行为一致）。
 * 未设 / C / POSIX → 'en'。
 */
export function deriveSystemLanguage(env: EnvLocaleInput): string {
  const raw = pickLocale(env);
  if (raw === undefined || raw === '' || raw === 'C' || raw === 'POSIX') return 'en';

  // 去掉 .codeset 与 @modifier，仅保留 language[_region]
  // 例：zh_CN.UTF-8 → zh_CN；pt_BR.UTF-8@euro → pt_BR
  const stripped = raw.split('.')[0]?.split('@')[0] ?? '';
  if (stripped === '') return 'en';

  const [languageRaw, regionRaw] = stripped.split('_');
  const language = (languageRaw ?? '').toLowerCase();
  const region = (regionRaw ?? '').toUpperCase();

  // 中文按 region 区分简繁
  if (language === 'zh') {
    if (region === 'TW' || region === 'HK' || region === 'MO') return 'zh-Hant';
    // 默认含 CN / SG / MY / 无 region → 简体
    return 'zh-Hans';
  }

  // pt_BR 与 pt 区分（巴葡 vs 葡萄牙葡）
  if (language === 'pt' && region === 'BR') return 'pt-BR';

  // 其他语言：返回 language subtag（en / ja / ko / es / fr / de / ru / pt / vi 等）
  if (/^[a-z]{2,3}$/.test(language)) return language;

  return 'en';
}

function pickLocale(env: EnvLocaleInput): string | undefined {
  return env.LC_ALL ?? env.LC_MESSAGES ?? env.LANG;
}
