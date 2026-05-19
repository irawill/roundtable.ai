import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigPaths } from '../../src/config/paths.js';
import {
  ExportFormatError,
  clearHistory,
  exportRun,
  forgetRun,
  listRuns,
  pruneHistory,
  renderHistoryTable,
  showRun,
} from '../../src/persistence/history.js';
import { RunsIo } from '../../src/persistence/runs.js';
import { uuidv4 } from '../../src/shared/uuid.js';

let tmpRoot: string;
let paths: ConfigPaths;
let io: RunsIo;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rtai-history-test-'));
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

function createRun(opts: {
  startedAt: string;
  scene?: string;
  outcome?: string;
  resolvedOutput?: string;
  rawQuestion?: string;
}): string {
  const id = uuidv4();
  io.initRunDir(id, {});
  io.writeMeta(id, {
    run_id: id,
    schema_version: 1,
    path: 'multi_agent',
    started_at: opts.startedAt,
    ended_at: null,
    raw_question: opts.rawQuestion ?? '推荐扫地机器人',
    enhanced_question: '推荐扫地机器人（家用清洁）',
    scene: opts.scene ?? 'consumer',
    scene_source: 'auto',
    scene_fallback_used: false,
    participants: ['claude', 'codex'],
    enhancer_model: 'claude',
    executor_model: 'claude',
    executor_mode: 'fixed',
    executor_fallback_used: false,
    original_executor_model: null,
    rounds_completed: 3,
    outcome: opts.outcome ?? 'converged',
    language: {
      system: 'zh-Hans',
      requested_output: 'auto',
      resolved_output: opts.resolvedOutput ?? 'zh-Hans',
      resolved_ui: 'zh-Hans',
      source: 'auto_detected',
      confidence: 0.95,
      fallback_used: false,
    },
    usage: {},
    usage_totals: { grand_total: 12345 },
    adapter_versions: { claude: '1.2.3' },
    enhancer: { fallback_used: false },
  });
  return id;
}

describe('listRuns', () => {
  it('返回按 started_at 倒序', () => {
    const r1 = createRun({ startedAt: '2026-05-13T10:00:00.000Z' });
    const r2 = createRun({ startedAt: '2026-05-14T10:00:00.000Z' });
    const r3 = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    const items = listRuns({ runsIo: io, runsDir: paths.runsDir });
    expect(items.map((i) => i.run_id)).toEqual([r3, r2, r1]);
  });

  it('--scene 过滤', () => {
    createRun({ startedAt: '2026-05-13T10:00:00.000Z', scene: 'consumer' });
    createRun({ startedAt: '2026-05-14T10:00:00.000Z', scene: 'coding' });
    const items = listRuns({
      runsIo: io,
      runsDir: paths.runsDir,
      filter: { scene: 'coding' },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.scene).toBe('coding');
  });

  it('--lang 过滤（alias normalize）', () => {
    createRun({ startedAt: '2026-05-13T10:00:00.000Z', resolvedOutput: 'zh-Hans' });
    createRun({ startedAt: '2026-05-14T10:00:00.000Z', resolvedOutput: 'en' });
    const items = listRuns({
      runsIo: io,
      runsDir: paths.runsDir,
      filter: { lang: '简中' },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.resolvedOutputLang).toBe('zh-Hans');
  });

  it('question 截断到 50 字符', () => {
    const longQ = '推'.repeat(100);
    createRun({ startedAt: '2026-05-15T10:00:00.000Z', rawQuestion: longQ });
    const items = listRuns({ runsIo: io, runsDir: paths.runsDir });
    expect(items[0]!.question.endsWith('…')).toBe(true);
  });
});

describe('renderHistoryTable', () => {
  it('空 list → "(no runs found)"', () => {
    expect(renderHistoryTable([])).toBe('(no runs found)');
  });

  it('表格含表头与行', () => {
    createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    const items = listRuns({ runsIo: io, runsDir: paths.runsDir });
    const table = renderHistoryTable(items);
    expect(table).toContain('UUID');
    expect(table).toContain('Scene');
    expect(table).toContain('consumer');
    expect(table).toContain('12.3k'); // 12345 tokens 渲染为 12.3k
  });
});

describe('showRun', () => {
  it('返回 meta + final.md', () => {
    const id = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    io.writeFinalMd(id, '# Final\n');
    const r = showRun({ runsIo: io, runId: id });
    expect(r).not.toBeNull();
    expect(r!.finalMd).toBe('# Final\n');
    expect((r!.meta as { scene: string }).scene).toBe('consumer');
  });

  it('runId 不存在 → null', () => {
    expect(showRun({ runsIo: io, runId: uuidv4() })).toBeNull();
  });
});

describe('exportRun', () => {
  it('format=md 返回 final.md 内容', () => {
    const id = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    io.writeFinalMd(id, '# x');
    expect(exportRun({ runsIo: io, runId: id, format: 'md' })).toBe('# x');
  });

  it('format=pdf → ExportFormatError', () => {
    const id = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    expect(() =>
      exportRun({ runsIo: io, runId: id, format: 'pdf' }),
    ).toThrow(ExportFormatError);
  });

  it('final.md 不存在 → ExportFormatError', () => {
    const id = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    expect(() =>
      exportRun({ runsIo: io, runId: id, format: 'md' }),
    ).toThrow(ExportFormatError);
  });
});

describe('pruneHistory — retain 策略', () => {
  it('unlimited 不删', () => {
    createRun({ startedAt: '2026-05-13T10:00:00.000Z' });
    createRun({ startedAt: '2026-05-14T10:00:00.000Z' });
    const deleted = pruneHistory({
      runsIo: io,
      runsDir: paths.runsDir,
      policy: 'unlimited',
    });
    expect(deleted).toEqual([]);
  });

  it('last_N 仅保留最新 N 条', () => {
    const r1 = createRun({ startedAt: '2026-05-13T10:00:00.000Z' });
    const r2 = createRun({ startedAt: '2026-05-14T10:00:00.000Z' });
    createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    const deleted = pruneHistory({
      runsIo: io,
      runsDir: paths.runsDir,
      policy: 'last_1',
    });
    expect(deleted.sort()).toEqual([r1, r2].sort());
  });

  it('ttl_Ndays 仅保留最近 N 天', () => {
    const now = new Date('2026-05-15T10:00:00.000Z');
    const r1 = createRun({ startedAt: '2026-01-01T10:00:00.000Z' }); // > 30 天前
    createRun({ startedAt: '2026-05-14T10:00:00.000Z' }); // 1 天前
    const deleted = pruneHistory({
      runsIo: io,
      runsDir: paths.runsDir,
      policy: 'ttl_30days',
      now,
    });
    expect(deleted).toEqual([r1]);
  });
});

describe('forgetRun / clearHistory', () => {
  it('forgetRun 删除指定 run', () => {
    const id = createRun({ startedAt: '2026-05-15T10:00:00.000Z' });
    expect(forgetRun({ runsIo: io, runId: id })).toBe(true);
    expect(showRun({ runsIo: io, runId: id })).toBeNull();
  });

  it('forgetRun 不存在 → false', () => {
    expect(forgetRun({ runsIo: io, runId: uuidv4() })).toBe(false);
  });

  it('clearHistory 清空所有 run 目录', () => {
    createRun({ startedAt: '2026-05-13T10:00:00.000Z' });
    createRun({ startedAt: '2026-05-14T10:00:00.000Z' });
    expect(clearHistory({ runsIo: io, runsDir: paths.runsDir })).toBe(2);
    expect(listRuns({ runsIo: io, runsDir: paths.runsDir })).toEqual([]);
  });
});
