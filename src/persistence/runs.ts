import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Event } from '../shared/event-types.js';
import type { ConfigPaths } from '../config/paths.js';
import {
  SECURE_DIR_MODE,
  SECURE_FILE_MODE,
  ensureSecureDir,
} from './permissions.js';
import { normalizeMeta, type RunMeta } from './meta.js';

/**
 * runs/<run_id>/ 目录与文件操作。
 *
 * 来自 §persistence-history "Run 目录持久化时机" + "Run 目录内的文件结构"
 * + "events.jsonl 仅追加写" + §finalizer "final.md 持久化"
 * + tasks.md §17.1-§17.4 + 跨阶段约束 #11。
 *
 * 文件结构：
 *   runs/<run_id>/
 *     meta.json
 *     events.jsonl     # append-only，每行一个 JSON event
 *     final.md         # Finalizer 输出（CANCELLED 路径不创建）
 *     attachments/     # 可选目录（v1 占位，无实际写入）
 *
 * 持久化时机由 Orchestrator 通过 RunContext.markPersistable() 决定；
 * 本模块仅提供"已确定要落盘"的写入操作。
 *
 * --no-persist 模式下，调用方 MUST NOT 调用本模块的写入函数。
 */

export class RunsIo {
  constructor(private readonly paths: ConfigPaths) {}

  /** 取 runs/<run_id>/ 目录绝对路径。 */
  runDir(runId: string): string {
    return join(this.paths.runsDir, runId);
  }

  /** 取 meta.json / events.jsonl / final.md / attachments/ 绝对路径。 */
  runFiles(runId: string): {
    dir: string;
    metaJson: string;
    eventsJsonl: string;
    finalMd: string;
    attachments: string;
  } {
    const dir = this.runDir(runId);
    return {
      dir,
      metaJson: join(dir, 'meta.json'),
      eventsJsonl: join(dir, 'events.jsonl'),
      finalMd: join(dir, 'final.md'),
      attachments: join(dir, 'attachments'),
    };
  }

  /**
   * 创建 runs/<run_id>/ 目录 + 初始 meta.json + 空 events.jsonl。
   *
   * 调用时机（来自 §persistence-history "Run 目录持久化时机"）：
   * - 多 agent / downgraded 路径：用户在确认页选 Y / edit 后
   * - 单 agent direct 路径：进入 SINGLE_AGENT_DIRECT_INVOKING 状态时
   * - --no-persist 模式：**不**调用本函数（由调用方拦截）
   *
   * 写盘后立刻 chmod 0700/0600 保证权限严格（mkdirSync mode 受 umask 影响）。
   */
  initRunDir(runId: string, initialMeta: Record<string, unknown>): void {
    const files = this.runFiles(runId);
    ensureSecureDir(files.dir);
    writeFileSync(files.metaJson, JSON.stringify(initialMeta, null, 2), {
      encoding: 'utf8',
      mode: SECURE_FILE_MODE,
    });
    // 创建空 events.jsonl（append-only）
    writeFileSync(files.eventsJsonl, '', { encoding: 'utf8', mode: SECURE_FILE_MODE });
  }

  /** runs/<run_id>/ 是否已存在（调用方判断是否要回填）。 */
  runDirExists(runId: string): boolean {
    return existsSync(this.runDir(runId));
  }

  /**
   * append-only 写一行事件到 events.jsonl。
   *
   * 来自 §persistence-history "events.jsonl 仅追加写"：MUST NOT 修改已写入行。
   */
  appendEvent(runId: string, event: Event): void {
    const path = this.runFiles(runId).eventsJsonl;
    appendFileSync(path, JSON.stringify(event) + '\n', { encoding: 'utf8' });
  }

  /** 批量回填 buffer 中的事件（用户确认后从 RunContext.drainBuffer() 取）。 */
  appendEventsBatch(runId: string, events: readonly Event[]): void {
    if (events.length === 0) return;
    const path = this.runFiles(runId).eventsJsonl;
    const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    appendFileSync(path, text, { encoding: 'utf8' });
  }

  /** 写 final.md。 */
  writeFinalMd(runId: string, markdown: string): void {
    writeFileSync(this.runFiles(runId).finalMd, markdown, {
      encoding: 'utf8',
      mode: SECURE_FILE_MODE,
    });
  }

  /** 覆写 meta.json（每次 round 结束 / finalize 时调用）。 */
  writeMeta(runId: string, meta: Record<string, unknown>): void {
    writeFileSync(this.runFiles(runId).metaJson, JSON.stringify(meta, null, 2), {
      encoding: 'utf8',
      mode: SECURE_FILE_MODE,
    });
  }

  /**
   * 读 meta.json，并经过 normalizeMeta 兜底补全 followup 字段（resume / history 用）。
   *
   * 返回 RunMeta（类型联合）；如需访问原始 raw 数据 / 损坏数据，用 readMetaRaw。
   */
  readMeta(runId: string): RunMeta | null {
    const raw = this.readMetaRaw(runId);
    if (raw === null) return null;
    return normalizeMeta(raw);
  }

  /** 读 meta.json 原始 JSON 对象（不补默认值）。 */
  readMetaRaw(runId: string): Record<string, unknown> | null {
    const path = this.runFiles(runId).metaJson;
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** 读 events.jsonl 全部行（resume 重建状态用）。 */
  readEvents(runId: string): Event[] {
    const path = this.runFiles(runId).eventsJsonl;
    if (!existsSync(path)) return [];
    const text = readFileSync(path, 'utf8');
    const events: Event[] = [];
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line) as Event);
      } catch {
        // 跳过非法行；events.jsonl 应当 append-only 严格 JSONL，但容错
      }
    }
    return events;
  }

  /** 读 final.md。 */
  readFinalMd(runId: string): string | null {
    const path = this.runFiles(runId).finalMd;
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  }
}

export { SECURE_DIR_MODE, SECURE_FILE_MODE };
