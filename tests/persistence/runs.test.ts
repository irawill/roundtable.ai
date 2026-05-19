import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConfigPaths } from '../../src/config/paths.js';
import { RunsIo } from '../../src/persistence/runs.js';
import { EventType, type Event } from '../../src/shared/event-types.js';
import { uuidv4 } from '../../src/shared/uuid.js';

let tmpRoot: string;
let paths: ConfigPaths;
let io: RunsIo;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'rtai-runs-test-'));
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

function makeEvent(type: EventType, runId: string, round?: number): Event {
  return {
    type,
    timestamp: '2026-05-15T10:00:00.000Z',
    run_id: runId,
    ...(round !== undefined ? { round } : {}),
    data: {},
  };
}

describe('RunsIo — 目录与文件路径', () => {
  it('runDir / runFiles 路径正确', () => {
    const id = uuidv4();
    expect(io.runDir(id)).toBe(join(paths.runsDir, id));
    const f = io.runFiles(id);
    expect(f.metaJson).toBe(join(paths.runsDir, id, 'meta.json'));
    expect(f.eventsJsonl).toBe(join(paths.runsDir, id, 'events.jsonl'));
    expect(f.finalMd).toBe(join(paths.runsDir, id, 'final.md'));
    expect(f.attachments).toBe(join(paths.runsDir, id, 'attachments'));
  });
});

describe('RunsIo — initRunDir', () => {
  it('创建目录 + meta.json + 空 events.jsonl', () => {
    const id = uuidv4();
    io.initRunDir(id, { run_id: id, schema_version: 1 });
    const f = io.runFiles(id);
    expect(existsSync(f.dir)).toBe(true);
    expect(existsSync(f.metaJson)).toBe(true);
    expect(existsSync(f.eventsJsonl)).toBe(true);
    expect(readFileSync(f.eventsJsonl, 'utf8')).toBe('');
    expect(JSON.parse(readFileSync(f.metaJson, 'utf8'))).toEqual({
      run_id: id,
      schema_version: 1,
    });
  });

  if (platform() !== 'win32') {
    it('目录权限 0700，文件权限 0600（POSIX）', () => {
      const id = uuidv4();
      io.initRunDir(id, {});
      const f = io.runFiles(id);
      expect(statSync(f.dir).mode & 0o777).toBe(0o700);
      expect(statSync(f.metaJson).mode & 0o777).toBe(0o600);
      expect(statSync(f.eventsJsonl).mode & 0o777).toBe(0o600);
    });
  }
});

describe('RunsIo — events.jsonl append-only', () => {
  it('appendEvent 每行一个 JSON 对象', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    io.appendEvent(id, makeEvent(EventType.EnhancementStarted, id));
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 1));
    const text = readFileSync(io.runFiles(id).eventsJsonl, 'utf8');
    const lines = text.split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).type).toBe('enhancement_started');
    expect(JSON.parse(lines[1]!).type).toBe('round_started');
  });

  it('appendEventsBatch 批量回填', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    io.appendEventsBatch(id, [
      makeEvent(EventType.EnhancementStarted, id),
      makeEvent(EventType.EnhancementCompleted, id),
    ]);
    const events = io.readEvents(id);
    expect(events).toHaveLength(2);
  });

  it('Round 3 写入不覆盖 Round 1 行', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 1));
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 2));
    io.appendEvent(id, makeEvent(EventType.RoundStarted, id, 3));
    const events = io.readEvents(id);
    expect(events.map((e) => e.round)).toEqual([1, 2, 3]);
  });
});

describe('RunsIo — final.md / meta.json', () => {
  it('writeFinalMd + readFinalMd 往返', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    io.writeFinalMd(id, '# Hello\n\nContent.');
    expect(io.readFinalMd(id)).toBe('# Hello\n\nContent.');
  });

  it('readFinalMd 文件不存在 → null', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    expect(io.readFinalMd(id)).toBeNull();
  });

  it('writeMeta + readMeta 往返（含 normalizeMeta 兜底字段）', () => {
    const id = uuidv4();
    io.initRunDir(id, { run_id: id, schema_version: 1 });
    io.writeMeta(id, { run_id: id, schema_version: 1, outcome: 'converged' });
    expect(io.readMeta(id)).toEqual({
      run_id: id,
      schema_version: 1,
      outcome: 'converged',
      parent_run_id: null,
      followup_depth: 0,
    });
  });

  it('writeMeta + readMetaRaw 不补默认字段', () => {
    const id = uuidv4();
    io.initRunDir(id, { run_id: id, schema_version: 1 });
    io.writeMeta(id, { run_id: id, schema_version: 1, outcome: 'converged' });
    expect(io.readMetaRaw(id)).toEqual({
      run_id: id,
      schema_version: 1,
      outcome: 'converged',
    });
  });

  it('readMeta 文件不存在 → null', () => {
    expect(io.readMeta(uuidv4())).toBeNull();
  });

  it('readMeta 损坏 JSON → null', () => {
    const id = uuidv4();
    io.initRunDir(id, {});
    writeFileSync(io.runFiles(id).metaJson, 'not json');
    expect(io.readMeta(id)).toBeNull();
  });
});
