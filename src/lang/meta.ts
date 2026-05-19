import { resolveLang } from '../shared/lang/alias.js';
import {
  getPackMeta,
  hasBuiltinPack,
  listBuiltinLanguages,
} from '../shared/lang/packs.js';
import { normalizeBcp47 } from '../shared/lang/bcp47.js';
import type { LanguageState } from './types.js';

/**
 * meta.json.language 段构造 + history --lang 过滤 + config language 子命令核心逻辑。
 *
 * 来自 §language-support "持久化字段" + "history 按语言过滤" + "配置子命令"
 * + tasks.md §16.13 / §16.14 / §16.15。
 *
 * **命名约定**：schema 字段使用短形式 `resolved_output` / `resolved_ui`，对应业务描述中的长名
 * `resolved_output_language` / `resolved_ui_language`（短形式仅在 JSON schema 内使用）。
 */

/** meta.json.language 字段形态（持久化用）。 */
export interface MetaLanguageBlock {
  system: string;
  requested_output: string;
  resolved_output: string;
  resolved_ui: string;
  source: LanguageState['source'];
  confidence: number | null;
  fallback_used: boolean;
}

/** 把内存 LanguageState 转 meta.json 持久化形态。 */
export function buildLanguageMeta(state: LanguageState): MetaLanguageBlock {
  return {
    system: state.system,
    requested_output: state.requested_output,
    resolved_output: state.resolved_output,
    resolved_ui: state.resolved_ui,
    source: state.source,
    confidence: state.confidence,
    fallback_used: state.fallback_used,
  };
}

/**
 * history --lang=&lt;tag&gt; 过滤（按 meta.json.language.resolved_output 匹配）。
 *
 * 来自 §persistence-history "rtai history 列表" --lang 过滤 + §language-support
 * "history 按语言过滤" Scenario：
 * - 用户传入的 tag 走 alias normalize → canonical BCP-47
 * - 与 meta.resolved_output 严格匹配（canonical 形式比较）
 *
 * @param userTag  用户传入的 --lang 值（可能是别名 / BCP-47 / 关键字）
 * @param metaResolvedOutput  某 run 的 meta.json.language.resolved_output
 * @returns 是否匹配
 */
export function matchesLangFilter(userTag: string, metaResolvedOutput: string): boolean {
  const resolved = resolveLang(userTag);
  if (resolved.kind === 'bcp47') {
    return resolved.value === normalizeBcp47(metaResolvedOutput);
  }
  // 关键字 auto / system 不参与 history 过滤（history 中已经是 resolved 后的 BCP-47）
  return false;
}

/**
 * `rtai config language show` 核心逻辑：返回当前语言配置摘要。
 *
 * Commander 包装在阶段 7 CLI 入口落地。
 */
export function buildLanguageShow(state: LanguageState): string {
  const systemName = getPackMeta(state.system)?.name ?? state.system;
  const outputName = getPackMeta(state.resolved_output)?.name ?? state.resolved_output;
  const uiName = getPackMeta(state.resolved_ui)?.name ?? state.resolved_ui;
  return [
    `system:           ${state.system} (${systemName})`,
    `requested_output: ${state.requested_output}`,
    `resolved_output:  ${state.resolved_output} (${outputName})`,
    `resolved_ui:      ${state.resolved_ui} (${uiName})`,
    `source:           ${state.source}`,
    `confidence:       ${state.confidence ?? 'n/a'}`,
    `fallback_used:    ${state.fallback_used}`,
  ].join('\n');
}

/**
 * `rtai config language list` 核心逻辑：列出 v1 内置 10 个翻译包 + alias 表 + 关键字说明。
 *
 * 用户通过 stdout 看到 verified / community 标签。
 */
export function buildLanguageList(): string {
  const lines: string[] = ['# v1 内置翻译包（共 10 个）', ''];
  for (const tag of listBuiltinLanguages()) {
    const meta = getPackMeta(tag);
    if (!meta) continue;
    const qualityTag = meta.quality === 'verified' ? '[verified]' : '[community]';
    lines.push(`- ${tag} — ${meta.name} ${qualityTag}`);
  }
  lines.push('');
  lines.push('# 关键字');
  lines.push('');
  lines.push('- `auto`   — 由 Enhancer 检测用户问题语言');
  lines.push('- `system` — 跟随系统 $LANG 推导的语言');
  lines.push('');
  lines.push('# 别名提示');
  lines.push('');
  lines.push('CLI 与 prefs 接受常见别名（如 `zh` / `简中` / `中文` → `zh-Hans`；`jp` / `日本語` → `ja`）；');
  lines.push('完整 alias 表见 `src/shared/lang/alias.ts`。');
  return lines.join('\n');
}

/**
 * `rtai config language set` 核心：把用户输入 normalize 为 prefs.yaml.language.output 的合法值。
 *
 * 返回值是即将写入 prefs 的字符串（'auto' / 'system' / canonical BCP-47），
 * 或者 error 表示输入非法。
 *
 * 调用方（阶段 7 CLI）负责实际写入 prefs.yaml + warn 文案。
 */
export function normalizeLangForPrefs(
  userInput: string,
): { kind: 'ok'; value: 'auto' | 'system' | string } | { kind: 'error'; message: string } {
  const r = resolveLang(userInput);
  if (r.kind === 'invalid') {
    return {
      kind: 'error',
      message: `非法语言值 "${userInput}"；运行 \`rtai config language list\` 查看合法值`,
    };
  }
  return { kind: 'ok', value: r.kind === 'keyword' ? r.value : r.value };
}

/**
 * `rtai config language set fallback &lt;tag&gt;`：仅接受合法 BCP-47（不接受关键字 auto / system）。
 */
export function normalizeFallbackLang(
  userInput: string,
): { kind: 'ok'; value: string } | { kind: 'error'; message: string } {
  const r = resolveLang(userInput);
  if (r.kind === 'bcp47') {
    if (!hasBuiltinPack(r.value)) {
      return {
        kind: 'error',
        message: `fallback 语言 "${r.value}" 不在 v1 内置 10 个翻译包中；可选：${listBuiltinLanguages().join(' / ')}`,
      };
    }
    return { kind: 'ok', value: r.value };
  }
  return {
    kind: 'error',
    message: `fallback 必须是合法 BCP-47（不接受 auto / system）；可选：${listBuiltinLanguages().join(' / ')}`,
  };
}

/**
 * `rtai config language set ui &lt;tag|system|match_output&gt;` 校验。
 */
export function normalizeUiLang(
  userInput: string,
): { kind: 'ok'; value: 'system' | 'match_output' | string } | { kind: 'error'; message: string } {
  if (userInput === 'system' || userInput === 'match_output') {
    return { kind: 'ok', value: userInput };
  }
  const r = resolveLang(userInput);
  if (r.kind === 'bcp47') return { kind: 'ok', value: r.value };
  return {
    kind: 'error',
    message: `非法 ui 语言值 "${userInput}"；合法：system / match_output / 任意 BCP-47`,
  };
}
