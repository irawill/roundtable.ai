import type { RunsIo } from '../persistence/runs.js';
import {
  FollowupError,
  loadChain,
  validateParentEligible,
} from '../persistence/followup.js';
import type { FollowupContext } from './run.js';

export { FollowupError } from '../persistence/followup.js';

/**
 * 加载 parent meta + 校验状态 + 构造 FollowupContext。
 *
 * CLI `rtai followup` 与 Web view `POST /api/followup` 共用此函数；
 * 返回的 `FollowupContext` 直接喂给 `runOrchestrator({ followupContext })`。
 *
 * 调用方负责：传 auto-confirm 的 userConfirm 回调（追问不弹用户确认页）。
 *
 * @throws FollowupError 若 parent 不存在 / 状态不合法 / final.md 缺失
 */
export function prepareFollowupContext(args: {
  io: RunsIo;
  parentRunId: string;
}): FollowupContext {
  const meta = args.io.readMeta(args.parentRunId);
  if (meta === null) {
    throw new FollowupError(`run ${args.parentRunId} not found`);
  }
  validateParentEligible(meta);
  const chain = loadChain(args.io, args.parentRunId);
  const depth = (meta.followup_depth ?? 0) + 1;
  return { chain, parentRunId: args.parentRunId, depth };
}

/**
 * 追问场景下的 userConfirm 回调：恒 confirm，不弹确认页。
 *
 * 用法：`runOrchestrator({ userConfirm: AUTO_CONFIRM_FOLLOWUP, followupContext })`。
 */
export const AUTO_CONFIRM_FOLLOWUP: () => Promise<'confirm'> = () => Promise.resolve('confirm');
