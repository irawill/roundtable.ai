import { z } from 'zod';

/**
 * models.yaml Zod schema。
 *
 * 来自 §agent-adapter "用户自加 adapter — YAML 描述" + §security-privacy "prompt 传递避免 argv 泄露"
 * + §effort-control "Adapter 提供 effort_mapping" + §token-usage-tracking。
 *
 * 命名约定（来自 §agent-adapter）：YAML 字段名用 snake_case；本 schema 直接定义 YAML 字段名形态。
 *
 * 同一 schema 涵盖：
 * - 内置 adapter（claude / codex / gemini）：YAML 中可显式配置部分字段（enabled / version / effort 等）；
 *   未指定字段由内置 adapter 默认填充
 * - 用户自加 YAML adapter：必须填齐 command / output / auth / capabilities 等字段才能注册 generic adapter
 *
 * 内置与自加的 schema 区别由"完整性校验"在加载层完成（本文件只定义合法形态，不做"哪些字段必填"的差异化）。
 */

/** 5 级 effort 等级，来自 §effort-control "5 级 effort 抽象"。 */
const EffortLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'max']);

/** Suitability 取值，仅作为 wizard 排序 hint（来自 §role-management）。 */
const SuitabilityLevelSchema = z.enum(['high', 'medium', 'low']);

/**
 * prompt 传递方式（来自 §security-privacy "prompt 传递避免 argv 泄露"）：
 * - stdin（默认）：spawn 时 prompt 写入 child.stdin
 * - tmpfile：写到 0600 临时文件，invoke 结束立即 unlink
 * - argv：长度 > 4KB 时 MUST 拒绝并 abort
 */
const PromptTransportSchema = z.enum(['stdin', 'tmpfile', 'argv']);

/**
 * 输出解析模式（来自 §agent-adapter "Adapter 调用 5 步骤" + tasks.md §4.2）：
 * - stream_json：解析 stream-json 格式（claude --output-format stream-json）
 * - json_extract：用 regex 抠 JSON 子串（用户自加 adapter 常用）
 * - pure_json：进程纯 JSON 输出，直接 JSON.parse
 * - code_fence：识别 ```json``` 块
 */
const OutputModeSchema = z.enum(['stream_json', 'json_extract', 'pure_json', 'code_fence']);

const OutputConfigSchema = z
  .object({
    mode: OutputModeSchema.default('json_extract'),
    /** 仅 json_extract 模式需要：抠 JSON 子串的正则 */
    json_regex: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'json_extract' && (val.json_regex === undefined || val.json_regex === '')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json_regex'],
        message: 'output.json_regex 在 output.mode = json_extract 时必填',
      });
    }
  });

/** Usage 提取方式（来自 §token-usage-tracking + tasks.md §4.5）。 */
const UsageModeSchema = z.enum(['stream_json', 'regex', 'json_path', 'none']);

const UsageConfigSchema = z
  .object({
    mode: UsageModeSchema,
    /** regex 模式：从 stdout / stderr 抠 input/output token 数 */
    regex: z.string().optional(),
    /** json_path 模式：从 parsed JSON 取 usage 对象（如 "usage" / "metadata.usage"） */
    json_path: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'regex' && !val.regex) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['regex'],
        message: 'usage.regex 在 usage.mode = regex 时必填',
      });
    }
    if (val.mode === 'json_path' && !val.json_path) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['json_path'],
        message: 'usage.json_path 在 usage.mode = json_path 时必填',
      });
    }
  });

/**
 * Auth 检测配置（来自 §agent-adapter "Auth 状态检测"）。
 *
 * 双轨 CLI（Codex）：check_command 是权威信号，check_env 仅作 fast path。
 * 至少要有 check_command 或 check_env 之一（加载时校验，本 schema 不强制）。
 */
const AuthConfigSchema = z.object({
  check_command: z.string().optional(),
  check_env: z.string().optional(),
  auth_command_hint: z.string(),
  stderr_expired_patterns: z.array(z.string()).default([]),
});

/** effort_mapping：5 级 → CLI flag 数组；未声明 level 视为 model 不支持（运行时取最接近 + warn）。 */
const EffortMappingSchema = z
  .object({
    none: z.array(z.string()).optional(),
    low: z.array(z.string()).optional(),
    medium: z.array(z.string()).optional(),
    high: z.array(z.string()).optional(),
    max: z.array(z.string()).optional(),
  })
  .default({});

/** role_suitability 仅作为 wizard 排序 hint（来自 §role-management）。 */
const RoleSuitabilitySchema = z.object({
  enhancer: SuitabilityLevelSchema.default('medium'),
  executor: SuitabilityLevelSchema.default('medium'),
});

/**
 * 单条 model 定义。
 *
 * 内置 adapter 与用户自加 YAML adapter 共享该 schema：
 * - 内置：未指定字段由 adapter 内置默认填充（如 prompt_transport=stdin，effort_mapping 由 adapter 自带）
 * - 自加：MUST 填齐 type / command / output / auth / capabilities / role_suitability / effort_mapping
 *   （完整性由加载层在注册 generic adapter 时校验）
 */
export const ModelConfigSchema = z
  .object({
    /** 是否启用；默认 false（用户在 wizard 显式启用） */
    enabled: z.boolean().default(false),

    /** model version 标识（如 claude-opus-4-7 / o3 / gemini-2.5-pro），可选 */
    version: z.string().optional(),

    /** YAML adapter 类型，仅自加 adapter 必填 */
    type: z.enum(['cli']).optional(),

    /** YAML adapter spawn 命令（如 ["bin", "subcommand"]），仅自加 adapter 必填 */
    command: z.array(z.string()).optional(),

    /** binary 绝对路径 override（缺省时从 $PATH 解析） */
    cli_path: z.string().optional(),

    /** per-agent timeout 秒数（默认 300，来自 §roundtable-orchestrator "默认 timeout"） */
    timeout_s: z.number().int().positive().default(300),

    /** 默认 effort 等级（可被 scene / CLI 覆盖；详见 §effort-control 4 层解析） */
    effort: EffortLevelSchema.optional(),

    /** 5 级 → CLI flag 数组映射 */
    effort_mapping: EffortMappingSchema,

    /** 能力声明（如 ["web_search", "code_understanding", "code_execution", "reasoning_effort"]） */
    capabilities: z.array(z.string()).default([]),

    /** wizard 排序 hint */
    role_suitability: RoleSuitabilitySchema.default({ enhancer: 'medium', executor: 'medium' }),

    auth: AuthConfigSchema.optional(),

    /** prompt 传递方式，默认 stdin */
    prompt_transport: PromptTransportSchema.default('stdin'),

    output: OutputConfigSchema.optional(),

    usage: UsageConfigSchema.optional(),
  })
  .strict();

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

/**
 * models.yaml 顶层：models map（key 为 model name，value 为 ModelConfig）。
 *
 * 顶层结构（来自 §agent-adapter "用户自加 adapter — YAML 描述" 实际写法）：
 *
 *   models:
 *     claude:
 *       enabled: true
 *       ...
 *     codex:
 *       enabled: true
 *       ...
 */
export const ModelsFileSchema = z.object({
  models: z.record(z.string(), ModelConfigSchema),
});

export type ModelsFile = z.infer<typeof ModelsFileSchema>;
