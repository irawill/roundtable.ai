import { Command } from 'commander';
import type { ConfigPaths } from '../config/paths.js';
import { RunsIo } from '../persistence/runs.js';
import { FollowupError, findRunByPrefix } from '../persistence/followup.js';
import { prepareFollowupContext } from '../orchestrator/followup.js';
import { CliError, ExitCode } from './errors.js';
import { attachGlobalOptions, parseGlobalOptions } from './options.js';
import type { LoadedConfigs } from './route.js';

/**
 * `rtai followup <parent_run_id> "<question>"` 子命令。
 *
 * 来自 §followup-rounds：
 * - 短前缀匹配 parent_run_id
 * - 拒绝 --no-persist（追问 run 必须落盘以便后续被引用）
 * - parent outcome ∉ {converged / escaped / single_agent_completed} → 拒绝
 * - 复用所有顶层 flag（--effort / --executor / --scene / --web-view / --lang / --ui-lang …）
 * - 委托主流程 runMainQuestion(..., followupContext)
 */

export interface FollowupCmdContext {
  paths: ConfigPaths;
  /** 测试注入：加载 configs（生产由 cli/index.ts 主入口提供） */
  loadConfigs: () => Promise<LoadedConfigs>;
  /** 测试注入：实际跑 followup（生产由 cli/index.ts 的 runMainQuestion 提供） */
  runMainQuestion: (args: {
    question: string;
    opts: import('./options.js').GlobalOptions;
    configs: LoadedConfigs;
    paths: ConfigPaths;
    followupContext: import('../orchestrator/run.js').FollowupContext;
  }) => Promise<number>;
  /** 测试注入：替换前缀解析（默认 findRunByPrefix） */
  resolveParentId?: (prefix: string) => string;
}

export function buildFollowupCommand(ctx: FollowupCmdContext): Command {
  const cmd = new Command('followup')
    .description('continue a prior roundtable run with a follow-up question')
    .argument('<parent_run_id>', 'parent run id (short prefix accepted)')
    .argument('<question>', 'follow-up question')
    .action(async (parentPrefix: string, question: string, _opts, command: Command) => {
      // commander 的 globalOptions 在父 Command 上；从 command.parent 拿
      const raw = command.parent !== null ? command.parent.opts() : command.opts();
      const opts = parseGlobalOptions(raw);

      // --no-persist 在追问场景被禁
      if (opts.persist === false) {
        throw new CliError(
          '--no-persist 与 followup 互斥；followup run 必须落盘以便能被后续追问引用',
          ExitCode.ConfigError,
        );
      }

      // 解析 parent_run_id 前缀
      const io = new RunsIo(ctx.paths);
      let parentRunId: string;
      try {
        parentRunId = ctx.resolveParentId
          ? ctx.resolveParentId(parentPrefix)
          : findRunByPrefix(io, ctx.paths.runsDir, parentPrefix);
      } catch (err) {
        if (err instanceof FollowupError) {
          throw new CliError(err.message, ExitCode.ConfigError);
        }
        throw err;
      }

      // 构造 followupContext
      let followupContext: import('../orchestrator/run.js').FollowupContext;
      try {
        followupContext = prepareFollowupContext({ io, parentRunId });
      } catch (err) {
        if (err instanceof FollowupError) {
          throw new CliError(err.message, ExitCode.ConfigError);
        }
        throw err;
      }

      const configs = await ctx.loadConfigs();
      const exitCode = await ctx.runMainQuestion({
        question,
        opts,
        configs,
        paths: ctx.paths,
        followupContext,
      });
      if (exitCode !== 0) process.exit(exitCode);
    });
  attachGlobalOptions(cmd);
  return cmd;
}
