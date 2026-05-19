/**
 * Canonical prompts 集合（来自 tasks.md §21.1 §21.2）。
 *
 * - 已知收敛（converged）：简单事实查询，3 agent 在 round 2-3 应达成共识
 * - 已知分歧（diverged）：开放式设计选择，5 轮内仍有 reasoning / alternative_view 分歧
 *
 * v0.1.0 测试用 mock adapter 模拟这些 prompt 的响应；阶段 8 + 用户本地 / CI 接真实 CLI 验证。
 */

export const CONVERGED_PROMPTS = [
  {
    name: 'simple_fact',
    rawQuestion: 'What is 2+2?',
    expectedScene: 'general',
    note: '简单事实，3 agent 应快速收敛到 "4"',
  },
  {
    name: 'simple_consumer',
    rawQuestion: '推荐一款 3000 元档的扫地机器人',
    expectedScene: 'consumer',
    note: '价位明确，3 agent 应能搜索后趋同',
  },
] as const;

export const DIVERGED_PROMPTS = [
  {
    name: 'design_choice',
    rawQuestion: '我们应该用 monorepo 还是 multirepo？团队 8 人，3 个独立产品。',
    expectedScene: 'decision',
    note: '开放式权衡，无客观正解，3 agent 应保持 alternative_view 分歧',
  },
  {
    name: 'subjective_recommendation',
    rawQuestion: '什么编程语言最好？',
    expectedScene: 'general',
    note: '主观题，3 agent 应给不同答案 + reasoning 分歧',
  },
] as const;
