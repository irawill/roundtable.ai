/**
 * Active agents 数量检查 + 运行中降级处理。
 *
 * 来自 §roundtable-orchestrator "运行中 active agents 降到 1 时 abort" Requirement
 * + tasks.md §9.8 + 跨阶段约束 #2 关于"运行中 active 降级"。
 *
 * 核心约定：
 * - 多 agent 圆桌路径运行中由于 ERRORED 拉黑 / auth 跳过 等原因导致 active < 2 时 → 整体 abort
 * - **不**降级切换到单 agent 直通路径（避免已发出的 round prompts schema 与单 agent schema 不一致）
 * - events.jsonl 完整保存
 * - stderr 输出"由于其他 agent 失败，当前剩余 active agents = 1，无法继续圆桌"+
 *   建议 `rtai config models disable <failed_agent>` 后重跑（将自动进入单 agent direct）
 *
 * 注意区分：
 * - **Layer 2 分支期间** participants.length 计算：由 §scene-system 的三重交集 + general scene
 *   fallback 处理；本模块不参与
 * - **Layer 2 分支已完成后**（即 BRANCHING_AFTER_CONFIRM → ROUND_RUNNING 后）由于拉黑等
 *   导致 active 缩小：本模块负责判定
 */

export type ActiveCheckResult =
  | { action: 'continue'; activeCount: number }
  | { action: 'abort'; reason: string; activeCount: number; remaining: readonly string[]; instructions: string };

export interface CheckActiveArgs {
  /** 当前活跃的 agent（已扣除拉黑的） */
  active: readonly string[];
  /** 本次 run 的 path（用于错误提示个性化） */
  path?: 'multi_agent' | 'single_agent';
}

/**
 * 主入口：检查 active 集合大小，返回 continue / abort。
 *
 * - multi_agent 路径：active < 2 → abort
 * - single_agent 路径：active = 0 → abort（此情形罕见，单 agent 路径仅 1 个 agent，
 *   失败重试 1 次后 abort 由 single-agent 模块处理）
 */
export function checkActive(args: CheckActiveArgs): ActiveCheckResult {
  const count = args.active.length;
  const path = args.path ?? 'multi_agent';

  if (path === 'multi_agent') {
    if (count < 2) {
      return {
        action: 'abort',
        activeCount: count,
        remaining: args.active,
        reason:
          count === 0
            ? '所有 agent 都已 ERRORED / 拉黑'
            : `由于其他 agent 失败，当前剩余 active agents = ${count}，无法继续圆桌`,
        instructions:
          count === 1 && args.active[0] !== undefined
            ? `建议禁用失败的 agent 后重跑：\`rtai config models disable <failed_agent>\`（将自动进入单 agent direct 路径仅用 ${args.active[0]}）`
            : '建议运行 `rtai config models check <name>` 排查各 agent 可用性',
      };
    }
    return { action: 'continue', activeCount: count };
  }

  // single_agent 路径
  if (count === 0) {
    return {
      action: 'abort',
      activeCount: 0,
      remaining: [],
      reason: '单 agent 路径下唯一 agent 不可用',
      instructions: '建议运行 `rtai config models check <name>` 排查',
    };
  }
  return { action: 'continue', activeCount: count };
}
