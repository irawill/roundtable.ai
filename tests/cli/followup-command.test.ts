import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { buildFollowupCommand } from '../../src/cli/followup-command.js';
import type { ConfigPaths } from '../../src/config/paths.js';
import type { MultiAgentMeta } from '../../src/persistence/meta.js';
import type { LoadedConfigs } from '../../src/cli/route.js';
import { CliError } from '../../src/cli/errors.js';

function makePaths(base: string): ConfigPaths {
  return {
    configDir: join(base, 'config'),
    modelsYaml: '',
    rolesYaml: '',
    scenesYaml: '',
    prefsYaml: '',
    adaptersMjs: '',
    runsDir: join(base, 'runs'),
    dataDir: join(base, 'data'),
  } as ConfigPaths;
}

const U1 = 'aaaaaaaa-1111-4111-8111-111111111111';

function writeRun(
  paths: ConfigPaths,
  runId: string,
  outcome: MultiAgentMeta['outcome'],
  finalMd: string,
): void {
  const dir = join(paths.runsDir, runId);
  mkdirSync(dir, { recursive: true });
  const meta: MultiAgentMeta = {
    run_id: runId,
    schema_version: 1,
    path: 'multi_agent',
    started_at: '2026-05-19T00:00:00Z',
    ended_at: '2026-05-19T00:01:00Z',
    raw_question: 'q',
    enhanced_question: 'eq',
    scene: 'general',
    scene_source: 'auto',
    scene_fallback_used: false,
    participants: ['claude'],
    enhancer_model: 'claude',
    executor_model: null,
    executor_mode: 'fixed',
    executor_fallback_used: false,
    original_executor_model: null,
    rounds_completed: 2,
    outcome,
    language: {
      system: 'en',
      requested_output: 'auto',
      resolved_output: 'en',
      resolved_ui: 'en',
      source: 'auto',
      confidence: 0.9,
      fallback_used: false,
    },
    usage: {} as MultiAgentMeta['usage'],
    usage_totals: { grand_total: 0 },
    adapter_versions: {},
    enhancer: { fallback_used: false },
    parent_run_id: null,
    followup_depth: 0,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(dir, 'final.md'), finalMd);
}

function runCmd(cmd: Command, argv: readonly string[]): Promise<void> {
  const root = new Command('rtai').exitOverride();
  // followup-command 通过 command.parent.opts() 拿全局 flag，所以挂在 root 上
  root.option('--no-persist');
  root.option('--scene <name>');
  root.option('--lang <tag>');
  root.option('--effort <spec>');
  root.addCommand(cmd);
  return root.parseAsync(['node', 'rtai', ...argv]);
}

const FAKE_CONFIGS = {} as LoadedConfigs;

describe('rtai followup', () => {
  it('--no-persist 抛 CliError', async () => {
    const base = mkdtempSync(join(tmpdir(), 'rtai-followup-cmd-'));
    try {
      const paths = makePaths(base);
      mkdirSync(paths.runsDir, { recursive: true });
      writeRun(paths, U1, 'converged', 'F1');
      const cmd = buildFollowupCommand({
        paths,
        loadConfigs: async () => FAKE_CONFIGS,
        runMainQuestion: async () => 0,
      });
      await expect(runCmd(cmd, ['followup', U1, '--no-persist', 'Q?'])).rejects.toThrow(
        /no-persist.*followup/i,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('parent 不存在抛 CliError not found', async () => {
    const base = mkdtempSync(join(tmpdir(), 'rtai-followup-cmd-'));
    try {
      const paths = makePaths(base);
      mkdirSync(paths.runsDir, { recursive: true });
      const cmd = buildFollowupCommand({
        paths,
        loadConfigs: async () => FAKE_CONFIGS,
        runMainQuestion: async () => 0,
      });
      await expect(runCmd(cmd, ['followup', 'zzz', 'Q?'])).rejects.toThrow(/not found/i);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('parent aborted 抛 CliError', async () => {
    const base = mkdtempSync(join(tmpdir(), 'rtai-followup-cmd-'));
    try {
      const paths = makePaths(base);
      mkdirSync(paths.runsDir, { recursive: true });
      writeRun(paths, U1, 'aborted', 'F1');
      const cmd = buildFollowupCommand({
        paths,
        loadConfigs: async () => FAKE_CONFIGS,
        runMainQuestion: async () => 0,
      });
      await expect(runCmd(cmd, ['followup', U1, 'Q?'])).rejects.toThrow(CliError);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('正常路径：解析前缀 + 调 runMainQuestion 一次，followupContext 含 parent + depth=1', async () => {
    const base = mkdtempSync(join(tmpdir(), 'rtai-followup-cmd-'));
    try {
      const paths = makePaths(base);
      mkdirSync(paths.runsDir, { recursive: true });
      writeRun(paths, U1, 'converged', 'F1');
      let calls = 0;
      let capturedCtx: import('../../src/orchestrator/run.js').FollowupContext | undefined;
      let capturedQuestion = '';
      const cmd = buildFollowupCommand({
        paths,
        loadConfigs: async () => FAKE_CONFIGS,
        runMainQuestion: async (args) => {
          calls++;
          capturedCtx = args.followupContext;
          capturedQuestion = args.question;
          return 0;
        },
      });
      // 用 8 字符短前缀
      await runCmd(cmd, ['followup', 'aaaaaaaa', '保养有什么坑']);
      expect(calls).toBe(1);
      expect(capturedQuestion).toBe('保养有什么坑');
      expect(capturedCtx?.parentRunId).toBe(U1);
      expect(capturedCtx?.depth).toBe(1);
      expect(capturedCtx?.chain).toHaveLength(1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
