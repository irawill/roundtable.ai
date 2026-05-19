import { z } from 'zod';

/**
 * roles.yaml Zod schema。
 *
 * 来自 §role-management "roles.yaml schema" + "executor 的 4 种 mode"。
 *
 * 约束：
 * - enhancer.mode 目前只支持 fixed（其他 mode 启动报错）
 * - enhancer.model 必填（fixed 必有指定 model）
 * - executor.mode ∈ {fixed, rotate, random, per_scene}
 * - executor.mode = fixed 时 model 必填
 * - executor.mode 为其他值时 model 可缺省（被忽略）
 */

const EnhancerSchema = z
  .object({
    /** 目前只支持 fixed；其他值由 superRefine 拒绝并明确报错 */
    mode: z.string(),
    model: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode !== 'fixed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mode'],
        message: 'enhancer 目前只支持 fixed mode（来自 §role-management roles.yaml schema）',
      });
    }
    if (!val.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'enhancer.model 必填（fixed mode 必有指定 model）',
      });
    }
  });

const ExecutorModeSchema = z.enum(['fixed', 'rotate', 'random', 'per_scene']);

const ExecutorSchema = z
  .object({
    mode: ExecutorModeSchema,
    /** mode = fixed 时必填；其他 mode 此字段忽略 */
    model: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'fixed' && !val.model) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'executor.mode = fixed 时 model 必填',
      });
    }
  });

export const RolesFileSchema = z.object({
  enhancer: EnhancerSchema,
  executor: ExecutorSchema,
});

export type RolesFile = z.infer<typeof RolesFileSchema>;
