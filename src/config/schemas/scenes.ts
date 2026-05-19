import { z } from 'zod';

/**
 * scenes.yaml Zod schema。
 *
 * 来自 §scene-system "用户自定义 scene" + "Scene 影响 7 层运行时行为"
 * + "convergence_strictness 三档" + "scene 的 effort 字段可选" + "scene 内可选 executor 配置"
 * + §finalizer "output_format 取值与语义（约束前移）"。
 *
 * 9 必填字段 + 3 可选字段（共 12）。
 */

const EffortLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'max']);

/** convergence_strictness 三档（来自 §scene-system "convergence_strictness 三档"）。 */
const StrictnessSchema = z.enum(['strict', 'medium', 'loose']);

/**
 * output_format 6 种合法取值（来自 §finalizer "output_format 取值与语义（约束前移）"）。
 *
 * 未知值在加载时 fallback 到 markdown + warn（由 Orchestrator 在 prompt 注入阶段处理，
 * 本 schema 严格只接受 6 种枚举值——避免拼写错误静默通过）。
 */
const OutputFormatSchema = z.enum([
  'markdown',
  'markdown_with_comparison_table',
  'markdown_with_code_blocks',
  'markdown_with_citations',
  'markdown_with_pros_cons',
  'markdown_with_stepped_reasoning',
]);

/**
 * scene 内可选 executor 配置（来自 §scene-system "scene 内可选 executor 配置"）。
 *
 * 当 roles.yaml.executor.mode = per_scene 时使用；scene 内 mode MUST NOT 为 per_scene 避免循环。
 * Zod superRefine 强制拒绝 per_scene 嵌套。
 */
const SceneExecutorSchema = z
  .object({
    mode: z.enum(['fixed', 'rotate', 'random', 'per_scene']),
    model: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'per_scene') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'scene 内 executor.mode MUST NOT 为 per_scene（避免循环）',
      });
    }
    if (val.mode === 'fixed' && !val.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'scene 内 executor.mode = fixed 时 model 必填',
      });
    }
  });

/**
 * 单个 scene 定义。
 */
export const SceneConfigSchema = z
  .object({
    /** 人类可读说明（必填） */
    description: z.string().min(1, 'scene.description 不能为空'),

    /** 偏好的模型组合（参与 §scene-system 三重交集第一项） */
    models: z.array(z.string()).min(1, 'scene.models 至少含 1 个 model'),

    /** 最小轮次（防止过早收敛，详见 §roundtable-orchestrator） */
    min_rounds: z.number().int().min(1),

    /** 最大轮次（达到后强制 escape） */
    max_rounds: z.number().int().min(1),

    convergence_strictness: StrictnessSchema,

    /** 注入每个 agent 的 system 段角色 prompt */
    agent_role_prompt: z.string().min(1),

    /** Enhancer 关注的补全维度文案 */
    enhancer_focus: z.string().min(1),

    /** 必需能力声明，允许空数组（表示无能力要求） */
    required_capabilities: z.array(z.string()).default([]),

    /** §finalizer output_format 6 种合法取值之一 */
    output_format: OutputFormatSchema,

    /** 可选：scene 级 effort 覆盖 model 默认（来自 §scene-system "scene 的 effort 字段可选"） */
    effort: EffortLevelSchema.optional(),

    /** 可选：按 model 分别指定 effort（优先于 scene.effort） */
    effort_per_model: z.record(z.string(), EffortLevelSchema).optional(),

    /** 可选：scene 内 executor 配置；仅 roles.yaml.executor.mode = per_scene 时使用 */
    executor: SceneExecutorSchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.max_rounds < val.min_rounds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['max_rounds'],
        message: 'scene.max_rounds 不能小于 min_rounds',
      });
    }
  });

export type SceneConfig = z.infer<typeof SceneConfigSchema>;

/**
 * scenes.yaml 顶层：scenes map（key 为 scene name，value 为 SceneConfig）。
 *
 *   scenes:
 *     general:
 *       description: ...
 *       ...
 */
export const ScenesFileSchema = z.object({
  scenes: z.record(z.string(), SceneConfigSchema),
});

export type ScenesFile = z.infer<typeof ScenesFileSchema>;
