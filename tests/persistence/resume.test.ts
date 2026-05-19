import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigPaths } from '../../src/config/paths.js';
import { ResumeError, buildResumeState } from '../../src/persistence/resume.js';
import { RunsIo } from '../../src/persistence/runs.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { uuidv4 } from '../../src/shared/uuid.js';

let tmpRoot: string;
let paths: ConfigPaths;
let io: RunsIo;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rtai-resume-test-'));
  paths = {
    configDir: join(tmpRoot, 'config'),
    dataDir: join(tmpRoot, 'data'),
    runsDir: join(tmpRoot, 'data', 'runs'),
    modelsYaml: '',
    scenesYaml: '',
    rolesYaml: '',
    prefsYaml: '',
    adaptersMjs: '',
  };
  io = new RunsIo(paths);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeEvent(type: EventType, runId: string, round?: number, data: Record<string, unknown> = {}): Event {
  return {
    type,
    timestamp: '2026-05-15T10:00:00.000Z',
    run_id: runId,
    ...(round !== undefined ? { round } : {}),
    data,
  };
}

function setupRun(outcome: string): string {
  const id = uuidv4();
  io.initRunDir(id, {});
  io.writeMeta(id, {
    run_id: id,
    schema_version: 1,
    path: 'multi_agent',
    started_at: '2026-05-15T10:00:00.000Z',
    ended_at: null,
    raw_question: 'q',
    enhanced_question: 'eq',
    scene: 'consumer',
    scene_source: 'auto',
    scene_fallback_used: false,
    participants: ['a', 'b'],
    enhancer_model: 'a',
    executor_model: 'a',
    executor_mode: 'fixed',
    executor_fallback_used: false,
    original_executor_model: null,
    rounds_completed: 0,
    outcome,
    language: {
      system: 'en',
      requested_output: 'auto',
      resolved_output: 'en',
      resolved_ui: 'en',
      source: 'auto_detected',
      confidence: 0.9,
      fallback_used: false,
    },
    usage: {},
    usage_totals: { grand_total: 0 },
    adapter_versions: {},
    enhancer: { fallback_used: false },
  });
  return id;
}

describe('buildResumeState — 拒绝已完成', () => {
  it('已 converged → throw ResumeError', () => {
    const id = setupRun('converged');
    expect(() => buildResumeState({ runsIo: io, runId: id })).toThrow(ResumeError);
  });

  it('已 escaped → throw', () => {
    const id = setupRun('escaped');
    expect(() => buildResumeState({ runsIo: io, runId: id })).toThrow(ResumeError);
  });

  it('已 single_agent_completed → throw', () => {
    const id = setupRun('single_agent_completed');
    expect(() => buildResumeState({ runsIo: io, runId: id })).toThrow(ResumeError);
  });

  it('已 aborted → throw（建议重跑而非 resume）', () => {
    const id = setupRun('aborted');
    expect(() => buildResumeState({ runsIo: io, runId: id })).toThrow(ResumeError);
  });
});

describe('buildResumeState — 找不到 run', () => {
  it('runs/<uuid>/ 不存在 → throw', () => {
    expect(() =>
      buildResumeState({ runsIo: io, runId: uuidv4() }),
    ).toThrow(ResumeError);
  });

  it('--no-persist run 的 uuid 找不到 → throw（findable via meta absent）', () => {
    // --no-persist 不写盘 → readMeta 返回 null
    expect(() =>
      buildResumeState({ runsIo: io, runId: uuidv4() }),
    ).toThrow(ResumeError);
  });
});

describe('buildResumeState — 从 events 重建', () => {
  it('找最后 round_completed → lastCompletedRound = nextRound - 1', () => {
    // 用 outcome='converged' 不行（会被拒）；本测试需要 outcome 不在拒绝列表中
    // 但 meta.outcome 4 个值都拒绝...
    // spec "中途 Ctrl-C" 路径下 outcome 在 meta 中是哪种？
    // 实际：Ctrl-C 时 meta.outcome 应当仍是初始 / 未设；schema 类型上 outcome 是必填...
    // 简化：mock 一个非标准 outcome 让 resume 接受；spec 留空
    const id = uuidv4();
    io.initRunDir(id, {});
    io.writeMeta(id, {
      run_id: id,
      schema_version: 1,
      path: 'multi_agent',
      started_at: '2026-05-15T10:00:00.000Z',
      ended_at: null,
      raw_question: 'q',
      enhanced_question: 'eq',
      scene: 'consumer',
      scene_source: 'auto',
      scene_fallback_used: false,
      participants: ['a', 'b'],
      enhancer_model: 'a',
      executor_model: 'a',
      executor_mode: 'fixed',
      executor_fallback_used: false,
      original_executor_model: null,
      rounds_completed: 2,
      // 用非完结 outcome 让 resume 接受；本字段是测试用 hack
      outcome: 'in_progress',
      language: {
        system: 'en',
        requested_output: 'auto',
        resolved_output: 'en',
        resolved_ui: 'en',
        source: 'auto_detected',
        confidence: 0.9,
        fallback_used: false,
      },
      usage: {},
      usage_totals: { grand_total: 0 },
      adapter_versions: {},
      enhancer: { fallback_used: false },
    });
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 1));
    io.appendEvent(
      id,
      makeEvent(EventType.AgentResponded, id, 1, {
        agent: 'a',
        output: { answer: 'a1', key_claims: [], uncertainty_notes: [], search_evidence: [], self_stability: 'refining', self_change_summary: '', peer_review: [] },
      }),
    );
    io.appendEvent(id, makeEvent(EventType.RoundCompleted, id, 1));
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 2));
    io.appendEvent(id, makeEvent(EventType.RoundCompleted, id, 2));

    const state = buildResumeState({ runsIo: io, runId: id });
    expect(state.lastCompletedRound).toBe(2);
    expect(state.nextRound).toBe(3);
    expect(state.previousOutputs.get('a')?.answer).toBe('a1');
  });
});
