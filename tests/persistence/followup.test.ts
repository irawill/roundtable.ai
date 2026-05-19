import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunsIo } from '../../src/persistence/runs.js';
import type { ConfigPaths } from '../../src/config/paths.js';
import type { MultiAgentMeta } from '../../src/persistence/meta.js';
import {
  FollowupError,
  findRunByPrefix,
  loadChain,
  validateParentEligible,
} from '../../src/persistence/followup.js';

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
const U3 = 'cccccccc-3333-4333-8333-333333333333';

describe('findRunByPrefix', () => {
  let base: string;
  let paths: ConfigPaths;
  let io: RunsIo;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'rtai-followup-prefix-'));
    paths = makePaths(base);
    mkdirSync(paths.runsDir, { recursive: true });
    io = new RunsIo(paths);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('精确匹配返回单个', () => {
    writeRun(paths, U1, {}, 'final');
    expect(findRunByPrefix(io, paths.runsDir, U1)).toBe(U1);
  });

  it('短前缀匹配返回单个', () => {
    writeRun(paths, U1, {}, 'final');
    writeRun(paths, U2, {}, 'final');
    expect(findRunByPrefix(io, paths.runsDir, 'aaaaaaaa')).toBe(U1);
  });

  it('多匹配抛 ambiguous', () => {
    writeRun(paths, U1, {}, 'final');
    writeRun(paths, 'aaaaaaaa-2222-4222-8222-222222222222', {}, 'final');
    expect(() => findRunByPrefix(io, paths.runsDir, 'aaaaaaaa')).toThrow(FollowupError);
  });

  it('无匹配抛 not found', () => {
    expect(() => findRunByPrefix(io, paths.runsDir, 'zzz')).toThrow(FollowupError);
  });
});

describe('validateParentEligible', () => {
  it('converged 通过', () => {
    expect(() =>
      validateParentEligible({ outcome: 'converged' } as MultiAgentMeta),
    ).not.toThrow();
  });
  it('escaped 通过', () => {
    expect(() =>
      validateParentEligible({ outcome: 'escaped' } as MultiAgentMeta),
    ).not.toThrow();
  });
  it('single_agent_completed 通过', () => {
    expect(() =>
      validateParentEligible({ outcome: 'single_agent_completed' } as unknown as MultiAgentMeta),
    ).not.toThrow();
  });
  it('aborted 抛', () => {
    expect(() =>
      validateParentEligible({ outcome: 'aborted', run_id: 'r' } as MultiAgentMeta),
    ).toThrow(FollowupError);
  });
});

describe('loadChain', () => {
  let base: string;
  let paths: ConfigPaths;
  let io: RunsIo;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'rtai-followup-chain-'));
    paths = makePaths(base);
    mkdirSync(paths.runsDir, { recursive: true });
    io = new RunsIo(paths);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('单层链：parent 是 root', () => {
    writeRun(paths, U1, { enhanced_question: 'Q1', parent_run_id: null, followup_depth: 0 }, 'F1');
    const chain = loadChain(io, U1);
    expect(chain).toEqual([{ runId: U1, enhancedQuestion: 'Q1', finalMd: 'F1' }]);
  });

  it('三层链按时序返回（最旧在前）', () => {
    writeRun(paths, U1, { enhanced_question: 'Q1', parent_run_id: null, followup_depth: 0 }, 'F1');
    writeRun(paths, U2, { enhanced_question: 'Q2', parent_run_id: U1, followup_depth: 1 }, 'F2');
    writeRun(paths, U3, { enhanced_question: 'Q3', parent_run_id: U2, followup_depth: 2 }, 'F3');
    const chain = loadChain(io, U3);
    expect(chain.map((c) => c.enhancedQuestion)).toEqual(['Q1', 'Q2', 'Q3']);
  });

  it('final.md 缺失抛', () => {
    writeRun(paths, U1, { enhanced_question: 'Q1', parent_run_id: null }, null);
    expect(() => loadChain(io, U1)).toThrow(FollowupError);
  });
});
