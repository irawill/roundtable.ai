import type { PeerReviewItem, Round1Output, Round2PlusOutput } from '../shared/agent-output-schema.js';

/**
 * 分歧矩阵抽取与 markdown 表格渲染。
 *
 * 来自 §finalizer "分歧矩阵格式" Requirement + tasks.md §11.5。
 *
 * 表格列头：`分歧点` + 每个 active agent 的 name（顺序与 agent 列表一致）
 * 每行：一个分歧主题；单元格 = 该 agent 在该主题上的立场（取自 disagreement.my_view 或对应
 * answer 中的相关片段）
 *
 * v1 简化：用 `disagreement.claim` 作为分歧主题；同一 claim 的 normalize（去空白 / 全角半角）
 * 后字面相同视为同一主题（与 consensus 一致）。
 */

import { normalizeClaim } from './normalize.js';

export interface DisagreementCell {
  /** 该 agent 是否对该 claim 表达过反驳 */
  hasView: boolean;
  /** 反驳内容（my_view）；hasView=false 时为空字符串 */
  view: string;
  /** disagreement 类型（factual / reasoning / cosmetic / alternative_view） */
  type?: string;
}

export interface DisagreementMatrix {
  /** 表格列：agent 列表（顺序与输入一致） */
  agents: string[];
  /** 表格行：每行是一个分歧主题 */
  rows: Array<{
    /** 分歧 claim（已 normalize） */
    claim: string;
    /** 每个 agent 在该主题上的立场（按 agents 顺序） */
    cells: DisagreementCell[];
  }>;
}

export interface BuildMatrixInput {
  /** 每个 active agent 的输出（Round 1 时 peer_review 缺席视为空） */
  agentOutputs: ReadonlyMap<string, Round1Output | Round2PlusOutput>;
}

/**
 * 从多 agent 的 peer_review 抽取分歧矩阵。
 *
 * 算法：
 * 1. 收集所有 agent 的 disagreement.claim（normalize 后）作为主题集合
 * 2. 对每个主题 × 每个 agent：
 *    - 查 agent 的 peer_review 是否对该 claim 有反驳（normalize 后字面相同）
 *    - 命中 → cell.hasView=true, view=disagreement.my_view
 *    - 未命中 → cell.hasView=false
 */
export function buildDisagreementMatrix(input: BuildMatrixInput): DisagreementMatrix {
  const agents = [...input.agentOutputs.keys()];
  if (agents.length === 0) return { agents: [], rows: [] };

  // 1. 收集所有主题（claim normalize 后去重；保持首次出现顺序）
  const claimsOrder: string[] = [];
  const claimsSet = new Set<string>();
  for (const output of input.agentOutputs.values()) {
    // Round 1 输出无 peer_review；视为空数组（不贡献任何分歧主题）
    const peerReview = (output as Round2PlusOutput).peer_review ?? [];
    for (const review of peerReview) {
      for (const dis of review.disagreements) {
        const norm = normalizeClaim(dis.claim);
        if (norm === '') continue;
        if (!claimsSet.has(norm)) {
          claimsSet.add(norm);
          claimsOrder.push(norm);
        }
      }
    }
  }

  // 2. 构造每行的 cell
  const rows: DisagreementMatrix['rows'] = claimsOrder.map((claim) => {
    const cells: DisagreementCell[] = agents.map((agent) => {
      const output = input.agentOutputs.get(agent)!;
      const peerReview = (output as Round2PlusOutput).peer_review ?? [];
      return findCellForClaim(peerReview, claim);
    });
    return { claim, cells };
  });

  return { agents, rows };
}

/** 在某 agent 的 peer_review 中查找对给定 claim 的反驳。 */
function findCellForClaim(
  peerReview: readonly PeerReviewItem[],
  normalizedClaim: string,
): DisagreementCell {
  for (const review of peerReview) {
    for (const dis of review.disagreements) {
      if (normalizeClaim(dis.claim) === normalizedClaim) {
        return { hasView: true, view: dis.my_view, type: dis.type };
      }
    }
  }
  return { hasView: false, view: '' };
}

/**
 * 把 DisagreementMatrix 渲染为 markdown 表格。
 *
 * 表头：`| 分歧点 | agent1 | agent2 | ... |`
 * 行：`| <claim> | <view or "—"> | ... |`
 */
export function renderMatrixMarkdown(
  matrix: DisagreementMatrix,
  /** 表头 "分歧点" 列的 i18n 文案（默认中文） */
  claimColumnLabel = '分歧点',
): string {
  if (matrix.rows.length === 0 || matrix.agents.length === 0) {
    return '_本轮无显著分歧。_';
  }

  const headers = [claimColumnLabel, ...matrix.agents];
  const lines: string[] = [];
  lines.push(`| ${headers.map(escapeCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);

  for (const row of matrix.rows) {
    const cells = [
      escapeCell(row.claim),
      ...row.cells.map((c) => (c.hasView ? escapeCell(c.view) : '—')),
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

/** 转义 markdown 表格单元格中的 | 与换行（变成 \|, 一行）。 */
function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
