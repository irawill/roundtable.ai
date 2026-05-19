import type { PeerReviewItem, Round2PlusOutput } from '../shared/agent-output-schema.js';

/**
 * peer_review 覆盖性 + agree-disagreements 强制运行时校验。
 *
 * 来自 §roundtable-orchestrator "Round 2+ schema 完整且 peer_review 覆盖性强制"
 * + "agree 与 disagreements 的逻辑一致性" + tasks.md §9.5 / §9.6 + 跨阶段约束 #13。
 *
 * Zod 静态 schema 之外的运行时 superRefine：
 *
 * **覆盖性**：peer_review 中的 agent 字段集合 MUST 严格等于"本轮其他 active agents 集合"：
 * - 不允许遗漏其他 active agent
 * - 不允许重复同一个 agent
 * - 不允许评审自己（agent == self）
 * - 不允许评审非 active agent
 *
 * **一致性**：
 * - agree=true → MUST 有非空 agreement_basis
 * - agree=false → MUST 有非空 disagreements[]
 * - NOT 允许 agree=false && disagreements=[]
 * - NOT 允许 agree=true && agreement_basis=''
 *
 * 校验失败处理路径（由调用方）：等同 JSON parse 失败 — 重试 1 次（带 completeness error 反馈
 * 给 prompt）→ 仍失败标 ERRORED。
 */

export type PeerReviewValidationOk = { ok: true };

export interface PeerReviewValidationError {
  ok: false;
  /** 一行人类可读错误（用于 prompt retry 时反馈 / stderr 输出） */
  message: string;
  /** 结构化错误码，便于上层分类 */
  code:
    | 'missing_agents'
    | 'extra_agents'
    | 'duplicate_agent'
    | 'self_reviewed'
    | 'agree_true_empty_basis'
    | 'agree_false_empty_disagreements';
  /** 涉及的 agent 名（如缺失 / 多余 / 评审自己的） */
  agents?: string[];
}

export type PeerReviewValidationResult = PeerReviewValidationOk | PeerReviewValidationError;

export interface ValidatePeerReviewArgs {
  /** 当前 agent 的 round 2+ 输出（已通过 Zod 静态校验） */
  output: Round2PlusOutput;
  /** 当前 agent 自己的名（用于 self-review 校验） */
  selfAgent: string;
  /** 本轮所有 active agents 集合（含 self） */
  activeAgents: readonly string[];
}

/**
 * 运行时校验 peer_review 覆盖性 + agree-disagreements 一致性。
 *
 * 多种错误同时存在时返回**第一个**触发的错误（便于反馈 prompt；prompt 处理后下一次重试可能暴露下一个）。
 * 调用方需要把 message 拼到 retry prompt 的 suffix 中。
 */
export function validatePeerReview(args: ValidatePeerReviewArgs): PeerReviewValidationResult {
  const expectedOthers = new Set(args.activeAgents.filter((a) => a !== args.selfAgent));
  const reviewedAgents: string[] = [];

  // 1. 自己评审自己
  for (const review of args.output.peer_review) {
    if (review.agent === args.selfAgent) {
      return {
        ok: false,
        code: 'self_reviewed',
        message: `peer_review 不允许评审自己（agent="${args.selfAgent}"）`,
        agents: [args.selfAgent],
      };
    }
  }

  // 2. 重复评审同一 agent
  for (const review of args.output.peer_review) {
    if (reviewedAgents.includes(review.agent)) {
      return {
        ok: false,
        code: 'duplicate_agent',
        message: `peer_review 重复评审 agent="${review.agent}"`,
        agents: [review.agent],
      };
    }
    reviewedAgents.push(review.agent);
  }

  // 3. 评审非 active agent
  const reviewedSet = new Set(reviewedAgents);
  const extras: string[] = [];
  for (const reviewed of reviewedSet) {
    if (!expectedOthers.has(reviewed)) {
      extras.push(reviewed);
    }
  }
  if (extras.length > 0) {
    return {
      ok: false,
      code: 'extra_agents',
      message: `peer_review 含非 active agent：${extras.join(' / ')}；active 集合：${[...expectedOthers].join(' / ')}`,
      agents: extras,
    };
  }

  // 4. 缺失 active agent
  const missing: string[] = [];
  for (const expected of expectedOthers) {
    if (!reviewedSet.has(expected)) {
      missing.push(expected);
    }
  }
  if (missing.length > 0) {
    return {
      ok: false,
      code: 'missing_agents',
      message: `peer_review 缺失对以下 active agent 的评审：${missing.join(' / ')}`,
      agents: missing,
    };
  }

  // 5. agree-disagreements 一致性
  for (const review of args.output.peer_review) {
    const consistency = checkAgreeDisagreements(review);
    if (consistency !== undefined) return consistency;
  }

  return { ok: true };
}

/**
 * 检查单条 peer_review 的 agree-disagreements 逻辑一致性。
 *
 * @returns undefined 表示一致；否则返回错误
 */
function checkAgreeDisagreements(review: PeerReviewItem): PeerReviewValidationError | undefined {
  if (review.agree === true) {
    if (review.agreement_basis.trim() === '') {
      return {
        ok: false,
        code: 'agree_true_empty_basis',
        message: `agent="${review.agent}" agree=true 但 agreement_basis 为空（MUST 含至少一句独立验证理由）`,
        agents: [review.agent],
      };
    }
  } else {
    // agree === false
    if (review.disagreements.length === 0) {
      return {
        ok: false,
        code: 'agree_false_empty_disagreements',
        message: `agent="${review.agent}" agree=false 但 disagreements=[]（MUST 列至少一条具体可检验分歧）`,
        agents: [review.agent],
      };
    }
  }
  return undefined;
}

/**
 * 构造 peer_review 校验失败的 retry prompt 后缀。
 *
 * 与 validate.ts 的 buildRetryPromptSuffix 结构一致：
 * - 分隔符 + 错误描述 + 修正要求
 */
export function buildPeerReviewRetrySuffix(error: PeerReviewValidationError): string {
  return [
    '',
    '---',
    '',
    '上次输出的 peer_review 字段校验失败。问题：',
    `- ${error.message}`,
    '',
    '请修正后**仅输出修正后的完整 JSON**（不要其他解释文本）。',
  ].join('\n');
}
