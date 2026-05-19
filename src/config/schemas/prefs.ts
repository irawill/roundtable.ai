import { z } from 'zod';

/**
 * prefs.yaml Zod schema。
 *
 * 来自 §setup-wizard "兜底缺失配置" + §security-privacy + §language-support
 * + §presenters + §command-alias "prefs.yaml 记录 alias 状态"。
 *
 * 八大段：
 * - defaults：max_rounds / min_rounds / max_total_seconds / abort_on_exceed
 * - ui：tui / web_view / web_port / verbosity
 * - language：output / ui / fallback / community_pack_notice
 * - editor：command
 * - history：retain_runs / redact_patterns
 * - security：adapters_mjs_trusted_mtime
 * - upgrade：check
 * - cli：primary_name / primary_status / primary_written_to / short_alias / short_alias_status /
 *        short_alias_written_to
 * + 顶层 auth_recovery_policy: skip | abort（默认 skip）
 */

const VerbositySchema = z.enum(['quiet', 'normal', 'verbose']);

/**
 * UI language 取值（来自 §language-support "UI 语言解析"）：
 * - system：取 system_language
 * - match_output：跟随 resolved_output_language
 * - 显式 BCP-47：canonical 形式（如 zh-Hans / en）
 *
 * 本 schema 接受任意非空字符串（具体值的合法性在加载层用 §language-support alias / BCP-47 校验）。
 */
const UiLanguageSchema = z.string().min(1);

/**
 * Output language 取值（来自 §language-support "输出语言三层优先级"）：
 * auto | system | 显式 BCP-47。同上由加载层做语义校验。
 */
const OutputLanguageSchema = z.string().min(1);

/**
 * Web view 三档（来自 §presenters "Web view presenter（默认开启）"）。
 */
const WebViewModeSchema = z.enum(['off', 'print_url_only', 'on']);

/**
 * Zod v4 的 `.default(x)` 在 input undefined 时返回 x **不再次跑 schema 解析**，
 * 因此内层字段的 `.default(...)` 不会级联（与 v3 行为差异，详见 Zod v4 changelog）。
 *
 * 解决：用 `.default(() => ...)` factory 显式返回完整默认对象；
 * 用户提供 partial 子对象时，内层字段的 `.default()` 仍按字段缺失走默认值。
 */
const DefaultsSchema = z
  .object({
    max_rounds: z.number().int().min(1).default(4),
    min_rounds: z.number().int().min(1).default(2),
    max_total_seconds: z.number().int().positive().default(600),
    abort_on_exceed: z.boolean().default(false),
  })
  .default(() => ({
    max_rounds: 4,
    min_rounds: 2,
    max_total_seconds: 600,
    abort_on_exceed: false,
  }));

const UiSchema = z
  .object({
    tui: z.enum(['on', 'off']).default('on'),
    web_view: WebViewModeSchema.default('on'),
    web_port: z.number().int().min(1).max(65535).default(7421),
    verbosity: VerbositySchema.default('normal'),
  })
  .default(() => ({
    tui: 'on' as const,
    web_view: 'on' as const,
    web_port: 7421,
    verbosity: 'normal' as const,
  }));

const LanguageSchema = z
  .object({
    output: OutputLanguageSchema.default('auto'),
    ui: UiLanguageSchema.default('system'),
    /** 仅"翻译包缺失"场景使用；MUST 是合法 BCP-47（加载层校验） */
    fallback: z.string().min(1).default('en'),
    community_pack_notice: z.enum(['on', 'off']).default('on'),
  })
  .default(() => ({
    output: 'auto',
    ui: 'system',
    fallback: 'en',
    community_pack_notice: 'on' as const,
  }));

const EditorSchema = z
  .object({
    /** $EDITOR / vim / nvim / code 等；默认 $EDITOR（由调用方在 spawn 时展开） */
    command: z.string().default('$EDITOR'),
  })
  .default(() => ({ command: '$EDITOR' }));

/** retain_runs 三种取值（来自 §persistence-history "history 保留策略"） */
const RetainPolicySchema = z.union([
  z.literal('unlimited'),
  z.string().regex(/^last_\d+$/, 'last_N 形式如 last_100'),
  z.string().regex(/^ttl_\d+days$/, 'ttl_Ndays 形式如 ttl_30days'),
]);

const HistorySchema = z
  .object({
    retain_runs: RetainPolicySchema.default('unlimited'),
    /** 正则字符串数组，落盘前用于 redact 敏感字段（来自 §security-privacy） */
    redact_patterns: z.array(z.string()).default([]),
  })
  .default(() => ({ retain_runs: 'unlimited' as const, redact_patterns: [] as string[] }));

const SecuritySchema = z
  .object({
    /** adapters.mjs 信任时间戳（epoch ms 或 null） */
    adapters_mjs_trusted_mtime: z.number().int().nullable().default(null),
  })
  .default(() => ({ adapters_mjs_trusted_mtime: null }));

const UpgradeSchema = z
  .object({
    check: z.enum(['on', 'off']).default('on'),
  })
  .default(() => ({ check: 'on' as const }));

/**
 * CLI alias 状态字段（来自 §command-alias "prefs.yaml 记录 alias 状态"）。
 *
 * primary_status：
 * - native：rtai 直接可用
 * - aliased：rtai 冲突走兜底 alias（如改成 rta）
 * - pending：等 wizard 决定（初始）
 *
 * short_alias_status：
 * - native：rt 已设短别名
 * - skipped：rt 冲突或主名走兜底跳过
 * - declined：用户拒绝
 * - pending：等 wizard 决定（初始）
 */
const CliSchema = z
  .object({
    primary_name: z.string().default('rtai'),
    primary_status: z.enum(['native', 'aliased', 'pending']).default('pending'),
    primary_written_to: z.string().nullable().default(null),
    short_alias: z.string().nullable().default(null),
    short_alias_status: z.enum(['native', 'skipped', 'declined', 'pending']).default('pending'),
    short_alias_written_to: z.string().nullable().default(null),
  })
  .default(() => ({
    primary_name: 'rtai',
    primary_status: 'pending' as const,
    primary_written_to: null,
    short_alias: null,
    short_alias_status: 'pending' as const,
    short_alias_written_to: null,
  }));

export const PrefsFileSchema = z
  .object({
    defaults: DefaultsSchema,
    ui: UiSchema,
    language: LanguageSchema,
    editor: EditorSchema,
    history: HistorySchema,
    security: SecuritySchema,
    upgrade: UpgradeSchema,
    cli: CliSchema,
    /** 来自 §agent-adapter "运行中 auth 恢复" Tier 3 默认 */
    auth_recovery_policy: z.enum(['skip', 'abort']).default('skip'),
  })
  .superRefine((val, ctx) => {
    // min_rounds / max_rounds 跨段一致性
    if (val.defaults.max_rounds < val.defaults.min_rounds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaults', 'max_rounds'],
        message: 'defaults.max_rounds 不能小于 min_rounds',
      });
    }
  });

export type PrefsFile = z.infer<typeof PrefsFileSchema>;

/**
 * 取 prefs.yaml 默认对象（缺失文件时写入）。
 *
 * 来自 §setup-wizard "兜底缺失配置" Requirement：
 *   max_rounds=4 / min_rounds=2 / max_total_seconds=600 / abort_on_exceed=false
 *   tui=on / web_view=on / web_port=7421 / verbosity=normal
 *   language.output=auto / language.ui=system / language.fallback=en / community_pack_notice=on
 *   editor.command=$EDITOR
 *   history.retain_runs=unlimited / redact_patterns=[]
 *   security.adapters_mjs_trusted_mtime=null
 *   upgrade.check=on
 *   auth_recovery_policy=skip
 *   cli.*=pending（等 wizard 决定）
 */
export function defaultPrefs(): PrefsFile {
  return PrefsFileSchema.parse({});
}
