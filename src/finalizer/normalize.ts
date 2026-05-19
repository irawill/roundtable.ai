/**
 * key_claims normalize（共识部分计算前的预处理）。
 *
 * 来自 §finalizer "共识部分计算 normalize" Requirement + tasks.md §11.4。
 *
 * Normalize 步骤：
 * - 去除首尾空白
 * - 中英文混排去除多余空格（连续 2+ 个空白 → 1 个）
 * - 全角标点 → 半角等价（。, → . / ，→ , / ；→ ; / 等）
 *
 * **不在 v1 范围**：embedding-based 语义聚类。Spec 已明确 v1 是字面 set 交集。
 */

/** 全角 → 半角标点映射（常用 punctuation）。 */
const PUNCTUATION_MAP: ReadonlyMap<string, string> = new Map([
  ['。', '.'],
  ['，', ','],
  ['、', ','],
  ['：', ':'],
  ['；', ';'],
  ['！', '!'],
  ['？', '?'],
  ['（', '('],
  ['）', ')'],
  ['「', '"'],
  ['」', '"'],
  ['『', '"'],
  ['』', '"'],
  ['“', '"'],
  ['”', '"'],
  ['‘', "'"],
  ['’', "'"],
  ['—', '-'],
  ['…', '...'],
]);

/**
 * 把一条 claim 字符串 normalize 为可比较形式。
 */
export function normalizeClaim(s: string): string {
  let result = s.trim();
  // 全角 → 半角标点
  result = Array.from(result)
    .map((ch) => PUNCTUATION_MAP.get(ch) ?? ch)
    .join('');
  // 连续 2+ 空白 → 1 个；用 \s 涵盖所有 unicode 空白
  result = result.replace(/\s+/g, ' ');
  return result;
}

/**
 * 计算多 agent 的 key_claims 字面 set 交集（共识部分）。
 *
 * 输入：每个 agent 的 key_claims[]；输出：normalize 后字面相同的 claim 集合（保持插入顺序）。
 *
 * 当 agentClaims 为空 / 单 agent 时返回空数组（无法谈"共识"）。
 */
export function computeConsensus(agentClaims: ReadonlyMap<string, readonly string[]>): string[] {
  const agents = [...agentClaims.keys()];
  if (agents.length < 2) return [];

  // 每个 agent 的 normalize 后 set
  const sets: Set<string>[] = [];
  for (const agent of agents) {
    const claims = agentClaims.get(agent) ?? [];
    sets.push(new Set(claims.map(normalizeClaim)));
  }

  // 取交集
  const [first, ...rest] = sets;
  if (first === undefined) return [];
  const result: string[] = [];
  for (const claim of first) {
    if (rest.every((s) => s.has(claim))) result.push(claim);
  }
  return result;
}
