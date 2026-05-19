import { Command } from 'commander';
import type { ConfigPaths } from '../config/paths.js';
import {
  ExportFormatError,
  clearHistory,
  exportRun,
  forgetRun,
  listRuns,
  renderHistoryTable,
  showRun,
} from '../persistence/history.js';
import { buildResumeState, ResumeError } from '../persistence/resume.js';
import { RunsIo } from '../persistence/runs.js';
import { CliError, ExitCode } from './errors.js';

/**
 * rtai history / show / resume / export 子命令。
 *
 * 来自 §persistence-history "rtai history 列表" / "rtai show 详情" / "rtai resume 恢复"
 * / "rtai export 导出" + §security-privacy "敏感输入与持久化控制" + tasks.md §17.5-§17.8 §20.5.8。
 */

export interface HistoryCmdContext {
  paths: ConfigPaths;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
}

export function buildHistoryCommand(ctx: HistoryCmdContext): Command {
  const stdout = ctx.stdout ?? ((s: string) => process.stdout.write(s));
  const io = new RunsIo(ctx.paths);

  const history = new Command('history').description('list and manage run history');
  history
    .option('--scene <name>', 'filter by scene')
    .option('--lang <tag>', 'filter by resolved output language')
    .action((opts: { scene?: string; lang?: string }) => {
      const items = listRuns({
        runsIo: io,
        runsDir: ctx.paths.runsDir,
        filter: opts,
      });
      stdout(renderHistoryTable(items) + '\n');
    });

  history
    .command('forget <uuid>')
    .description('delete a specific run')
    .action((uuid: string) => {
      const ok = forgetRun({ runsIo: io, runId: uuid });
      if (!ok) throw new CliError(`run ${uuid} not found`, ExitCode.ConfigError);
      stdout(`✓ removed runs/${uuid}/\n`);
    });

  history
    .command('clear')
    .description('delete all runs (use with caution)')
    .action(() => {
      const count = clearHistory({ runsIo: io, runsDir: ctx.paths.runsDir });
      stdout(`✓ removed ${count} run(s)\n`);
    });

  return history;
}

export function buildShowCommand(ctx: HistoryCmdContext): Command {
  const stdout = ctx.stdout ?? ((s: string) => process.stdout.write(s));
  const io = new RunsIo(ctx.paths);

  return new Command('show')
    .argument('<uuid>')
    .option('--rounds', 'show raw output per round per agent')
    .description('show meta + final.md of a run')
    .action((uuid: string, opts: { rounds?: boolean }) => {
      const r = showRun({ runsIo: io, runId: uuid, withRounds: opts.rounds === true });
      if (r === null) throw new CliError(`run ${uuid} not found`, ExitCode.ConfigError);
      stdout(JSON.stringify(r.meta, null, 2) + '\n\n');
      if (r.finalMd !== null) {
        stdout('--- final.md ---\n');
        stdout(r.finalMd);
        if (!r.finalMd.endsWith('\n')) stdout('\n');
      }
      if (opts.rounds === true && r.rounds !== undefined) {
        stdout('\n--- rounds ---\n');
        for (const round of r.rounds) {
          stdout(`\nRound ${round.round} | ${round.agent}\n${round.rawOutput}\n`);
        }
      }
    });
}

export function buildExportCommand(ctx: HistoryCmdContext): Command {
  const stdout = ctx.stdout ?? ((s: string) => process.stdout.write(s));
  const io = new RunsIo(ctx.paths);

  return new Command('export')
    .argument('<uuid>')
    .requiredOption('--format <format>', 'export format (md)')
    .description('export a run to stdout')
    .action((uuid: string, opts: { format: string }) => {
      try {
        const content = exportRun({ runsIo: io, runId: uuid, format: opts.format });
        stdout(content);
        if (!content.endsWith('\n')) stdout('\n');
      } catch (err) {
        if (err instanceof ExportFormatError) {
          throw new CliError(err.message, ExitCode.UsageError);
        }
        throw err;
      }
    });
}

export function buildResumeCommand(ctx: HistoryCmdContext): Command {
  const io = new RunsIo(ctx.paths);
  const stderr = ctx.stderr ?? ((s: string) => process.stderr.write(s));

  return new Command('resume')
    .argument('<uuid>')
    .description('resume an interrupted run')
    .action((uuid: string) => {
      try {
        const state = buildResumeState({ runsIo: io, runId: uuid });
        stderr(`(resume: lastCompletedRound=${state.lastCompletedRound}, nextRound=${state.nextRound})\n`);
        // v0.1.0 简化：resume 仅重建状态并提示用户；实际 round loop 续跑由阶段 8 集成测落地
        // （需要把 ResumeState 接进 Orchestrator round loop 入口）
        throw new CliError(
          'resume 重建状态成功，但 v0.1.0 暂未集成续跑（请用 rtai show 查看已有进度）',
          ExitCode.RuntimeError,
        );
      } catch (err) {
        if (err instanceof ResumeError) {
          throw new CliError(err.message, ExitCode.ConfigError);
        }
        throw err;
      }
    });
}
