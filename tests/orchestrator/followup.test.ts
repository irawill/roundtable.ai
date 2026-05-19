import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunsIo } from '../../src/persistence/runs.js';
import type { ConfigPaths } from '../../src/config/paths.js';
import type { MultiAgentMeta } from '../../src/persistence/meta.js';
import {
  AUTO_CONFIRM_FOLLOWUP,
  FollowupError,
  prepareFollowupContext,
} from '../../src/orchestrator/followup.js';

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

function writeRun(
  paths: ConfigPaths,
  runId: string,
  meta: Partial<MultiAgentMeta>,
  finalMd: string | null,
): void {
  const dir = join(paths.runsDir, runId);
  mkdirSync(dir, { recursive: true });
  const full: MultiAgentMeta = {
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
    outcome: 'converged',
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
    ...meta,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(full));
  if (finalMd !== null) writeFileSync(join(dir, 'final.md'), finalMd);
}

const U1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const U2 = 'bbbbbbbb-2222-4222-8222-222222222222';

describe('prepareFollowupContext', () => {
  let base: string;
  let paths: ConfigPaths;
  let io: RunsIo;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'rtai-orch-fu-'));
    paths = makePaths(base);
    mkdirSync(paths.runsDir, { recursive: true });
    io = new RunsIo(paths);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('parent 不存在抛 FollowupError', () => {
    expect(() => prepareFollowupContext({ io, parentRunId: U1 })).toThrow(FollowupError);
  });

  it('parent aborted 拒绝', () => {
    writeRun(paths, U1, { outcome: 'aborted' }, 'F');
    expect(() => prepareFollowupContext({ io, parentRunId: U1 })).toThrow(FollowupError);
  });

  it('parent converged 通过；返回 depth=1 + chain[0] 指向 parent', () => {
    writeRun(paths, U1, { enhanced_question: 'Q1', outcome: 'converged' }, 'F1');
    const ctx = prepareFollowupContext({ io, parentRunId: U1 });
    expect(ctx.parentRunId).toBe(U1);
    expect(ctx.depth).toBe(1);
    expect(ctx.chain).toEqual([{ runId: U1, enhancedQuestion: 'Q1', finalMd: 'F1' }]);
  });

  it('parent 已是 follow-up（depth=2）的 child depth=3', () => {
    writeRun(paths, U1, { enhanced_question: 'Q1', followup_depth: 0 }, 'F1');
    writeRun(
      paths,
      U2,
      { enhanced_question: 'Q2', parent_run_id: U1, followup_depth: 2 },
      'F2',
    );
    const ctx = prepareFollowupContext({ io, parentRunId: U2 });
    expect(ctx.depth).toBe(3);
    expect(ctx.chain.map((c) => c.enhancedQuestion)).toEqual(['Q1', 'Q2']);
  });
});

describe('AUTO_CONFIRM_FOLLOWUP', () => {
  it('恒返回 "confirm"', async () => {
    await expect(AUTO_CONFIRM_FOLLOWUP()).resolves.toBe('confirm');
  });
});
