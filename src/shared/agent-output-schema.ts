import { z } from 'zod';

/**
 * Agent 输出的三套 Zod schema（来自 §roundtable-orchestrator + tasks.md §2.6）：
 *
 * - Round1Schema：Round 1 简化版（不含 self_stability / peer_review，因为无上一轮可参照）
 * - Round2PlusSchema：Round 2+ 完整版（增加 self_stability / self_change_summary / peer_review）
 * - SingleAgentSchema：单 agent 路径共享版（direct + downgraded 仅区别在 prompt 来源与 scene 解析，
 *   schema 层完全一致）
 *
 * 注意：本文件仅做"形状"校验，不做运行时 peer_review 覆盖性 / agree-disagreements 一致性校验
 * （那两条规则需要知道"当前 active agents 集合"，属于 Orchestrator 上下文 → 在 superRefine 阶段
 * 实施，详见阶段 5）。
 */

/**
 * Round 1 与 Round 2+ 共享的基础字段。
 *
 * 注：spec 描述 key_claims / uncertainty_notes 用 [] 表示数组，未限制最小长度；
 * answer 是自由文本但 v1 允许空字符串（agent 偶尔会拒答），避免 Zod 拒绝合法但 odd 的输出。
 */
const BaseAnswerSchema = z.object({
  answer: z.string(),
  key_claims: z.array(z.string()),
  uncertainty_notes: z.array(z.string()).default([]),
  search_evidence: z
    .array(
      z.object({
        url: z.string().optional(),
        snippet: z.string().optional(),
        source: z.string().optional(),
      }),
    )
    .default([]),
});

/**
 * Round 1 schema：仅 base 字段。
 *
 * 来自 §roundtable-orchestrator "Round 1 schema 简化"：
 * - 接受 self_stability / self_change_summary / peer_review 等 round 2+ 字段（被忽略）
 * - 用 passthrough 允许未声明字段穿透，但不参与校验
 */
export const Round1Schema = BaseAnswerSchema.passthrough();

export type Round1Output = z.infer<typeof Round1Schema>;

/** disagreement.type 4 个枚举值（来自 §scene-system "convergence_strictness 三档" + §roundtable-orchestrator "Round 2+ schema"） */
export const DisagreementType = z.enum(['factual', 'reasoning', 'cosmetic', 'alternative_view']);

export type DisagreementType = z.infer<typeof DisagreementType>;

/** 单条 disagreement */
export const DisagreementSchema = z.object({
  claim: z.string(),
  my_view: z.string(),
  type: DisagreementType,
});

/**
 * 单条 peer_review 项。
 *
 * 注意：本 schema 仅做形状校验。agree-disagreements 逻辑一致性
 * （agree=true → agreement_basis 非空；agree=false → disagreements 非空）由 Orchestrator
 * 的运行时 superRefine 检查（详见 §roundtable-orchestrator "agree 与 disagreements 的逻辑一致性"）。
 */
export const PeerReviewItemSchema = z.object({
  agent: z.string(),
  agree: z.boolean(),
  agreement_basis: z.string().default(''),
  disagreements: z.array(DisagreementSchema).default([]),
});

export type PeerReviewItem = z.infer<typeof PeerReviewItemSchema>;

/**
 * Round 2+ schema：base + self_stability / self_change_summary / peer_review。
 *
 * 来自 §roundtable-orchestrator "Round 2+ schema 完整且 peer_review 覆盖性强制"。
 */
export const Round2PlusSchema = BaseAnswerSchema.extend({
  self_stability: z.enum(['stable', 'refining']),
  self_change_summary: z.string().default(''),
  peer_review: z.array(PeerReviewItemSchema),
}).passthrough();

export type Round2PlusOutput = z.infer<typeof Round2PlusSchema>;

/**
 * 单 agent 共享 schema（direct + downgraded）。
 *
 * 来自 tasks.md §2.6：direct / downgraded 在 schema 层无差别，区别仅在 prompt 来源与 scene 解析。
 * 仅含 answer，其他字段不要求；passthrough 接受 agent 误送的多字段（被忽略）。
 */
export const SingleAgentSchema = z
  .object({
    answer: z.string(),
  })
  .passthrough();

export type SingleAgentOutput = z.infer<typeof SingleAgentSchema>;
