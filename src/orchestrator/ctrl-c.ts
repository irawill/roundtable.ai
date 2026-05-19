/**
 * Ctrl-C 优雅退出处理。
 *
 * 来自 §roundtable-orchestrator "用户 Ctrl-C" 错误处理矩阵条目
 * + §presenters "Ctrl-C 触发优雅退出"
 * + tasks.md §8.6 + 跨阶段约束 #11 持久化时机。
 *
 * 行为：
 * - 用户按 Ctrl-C → 触发 SIGINT 处理：
 *   1. emit 一个 cancellation 事件
 *   2. 所有 subprocess SIGTERM（spawn 层已实现 timeout SIGTERM；Ctrl-C 复用此机制）
 *   3. 默认持久化模式：保存 events.jsonl（已落盘部分）+ 提示 `rtai resume <uuid>`
 *   4. --no-persist 模式：丢弃所有内存状态 + 提示 "Discarded (--no-persist; resume unavailable)"
 *
 * 本模块仅提供注册 SIGINT handler 的工具；实际 abort 逻辑在 Orchestrator 主入口中由
 * AbortController 驱动。
 */

export interface CtrlCHandler {
  /** 取消已注册的 handler（避免泄漏） */
  dispose: () => void;
  /** 当前是否已收到 Ctrl-C（一次注册可读，多次注册建议各自 dispose） */
  readonly aborted: () => boolean;
}

/**
 * 注册一个 SIGINT handler；返回 dispose 句柄 + aborted 状态查询。
 *
 * 调用方应在每个 Orchestrator run 启动前调用 register；run 结束时调 dispose 避免泄漏。
 *
 * @param onAbort  收到 Ctrl-C 时调用的回调（同步 / 异步均可；内部 try/catch 包裹）
 */
export function registerCtrlC(onAbort: () => void | Promise<void>): CtrlCHandler {
  let abortedFlag = false;
  const handler = async () => {
    if (abortedFlag) return; // 二次按 Ctrl-C 不重复触发
    abortedFlag = true;
    try {
      await onAbort();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ctrl-c] handler error:', err);
    }
  };

  process.on('SIGINT', handler);

  return {
    dispose: () => {
      process.off('SIGINT', handler);
    },
    aborted: () => abortedFlag,
  };
}
