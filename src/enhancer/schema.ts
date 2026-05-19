import { z } from 'zod';

/**
 * Enhancer 输出 Zod schema。
 *
 * 来自 §question-enhancer "单次 LLM 调用同时完成 4 件事" + "语言一致性的 Enhancer 输出"。
 *
 * Enhancer 单次 LLM 调用同时完成：
 * 1. 识别 scene → detected_scene + scene_confidence + scene_reasoning
 * 2. 自动补全可推断维度 → inferred_dimensions（值字符串必须 [推断] 前缀）
 * 3. 拼装 enhanced_question_so_far
 * 4. 反问 ≤3 个关键问题 → questions_for_user[]
 *
 * Auto 模式额外含：user_language（BCP-47）+ language_confidence（0..1）。
 * Explicit 模式不要求 language 字段；schema 用 .passthrough() 允许多余字段。
 */

/** v1 内置 scene 名 + 用户自定义 scene 名都可能；用 string 不限定枚举。 */
const DetectedSceneSchema = z.string().min(1);

/**
 * inferred_dimensions：键自由命名（如 budget / usage_scenario），值字符串
 * 必须以 "[推断]" 前缀开头（来自 §question-enhancer "不主观注入用户偏好倾向" Requirement
 * + "单次 LLM 调用" Scenario "inferred_dimensions 中的每条值字符串以 [推断] 开头"）。
 *
 * 校验时只对**值的形式**做检查；维度名（key）不限定。
 */
const InferredDimensionsSchema = z
  .record(z.string(), z.string())
  .refine(
    (rec) =>
      Object.values(rec).every((v) => v.startsWith('[推断]') || v.startsWith('[infer]') || v === ''),
    {
      message: 'inferred_dimensions 的值必须以 "[推断]" 前缀开头（来自 §question-enhancer）',
    },
  );

/** questions_for_user[]：≤3 个；spec "反问超过 3 个会被拒绝" 用 max(3)。 */
const QuestionsForUserSchema = z.array(z.string().min(1)).max(3, {
  message: 'questions_for_user 长度 MUST ≤ 3（详见 §question-enhancer "反问超过 3 个会被拒绝"）',
});

/**
 * 单一 schema 覆盖 auto / explicit 两种模式：
 * - explicit：user_language / language_confidence 字段可缺省（用 .optional()）
 * - auto：调用方在 Enhancer 主流程中额外校验 user_language 存在（detached check）
 *
 * 简化为一份 schema 而非两份，避免重复维护；模式差异由调用方决定是否额外读 language 字段。
 */
export const EnhancerOutputSchema = z
  .object({
    detected_scene: DetectedSceneSchema,
    /** 0..1 信心值，spec "scene_confidence >= 0.0 且 <= 1.0" */
    scene_confidence: z.number().min(0).max(1),
    /** 简短推理，便于 debug；空字符串允许 */
    scene_reasoning: z.string().default(''),
    inferred_dimensions: InferredDimensionsSchema,
    enhanced_question_so_far: z.string().min(1),
    questions_for_user: QuestionsForUserSchema,
    /** 仅 auto 模式：BCP-47 形式的检测语言；explicit 模式可缺省 */
    user_language: z.string().optional(),
    /** 仅 auto 模式：0..1 检测置信度；explicit 模式可缺省 */
    language_confidence: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export type EnhancerOutput = z.infer<typeof EnhancerOutputSchema>;
