/**
 * Web view HTTP server。
 *
 * 来自 §presenters "Web view presenter（默认开启）" + tasks.md §16。
 *
 * 设计：
 * - hono server 监听 prefs.ui.web_port（默认 7421），仅绑 127.0.0.1
 * - 仅两条路由：GET / → HTML；GET /api/state → JSON 状态
 * - 内部维护一个 WebViewState；CLI 在事件回调里 mutate state
 * - 浏览器 1s 轮询 /api/state；status=done/aborted 后停止轮询
 * - close() 优雅关闭；不阻塞主进程退出
 *
 * 端口冲突：如果 web_port 被占用，递增重试至多 10 次；都不行就 fallback 到随机端口。
 *
 * 安全：仅 127.0.0.1 绑定；不暴露到 LAN；no CORS（本地）。
 */

import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import type { WebViewRoundState, WebViewRunState, WebViewState } from './html.js';
import { renderWebViewHtml } from './html.js';
import { marked } from 'marked';

function emptyRun(
  rawQuestion: string,
  parentRunId: string | null,
  depth: number,
): WebViewRunState {
  return {
    runId: null,
    parentRunId,
    followupDepth: depth,
    rawQuestion,
    enhancedQuestion: null,
    scene: null,
    enhancerStatus: null,
    userConfirmed: null,
    rounds: [],
    status: 'running',
    finalHtml: null,
    abortReason: null,
    pendingConfirmation: null,
  };
}

/**
 * POST /api/followup 回调签名。
 *
 * 实现侧（CLI 主入口）应当：
 * 1. 用当前 tail run 的 run_id 作为 parent
 * 2. pushFollowupRun 推一段新 run 到 thread
 * 3. 异步启动 runOrchestrator；不要 await，让 POST 立即返回 new run_id
 * 4. 返回 new run_id（通常等 markPersistable 后 tail.runId 可见）
 */
export type FollowupHandler = (question: string) => Promise<string>;

export class WebViewServer {
  private state: WebViewState;
  private server: ServerType | null = null;
  private actualPort = 0;
  private onFollowup: FollowupHandler | null = null;

  constructor(initial: { port: number; rawQuestion: string }) {
    this.state = {
      port: initial.port,
      thread: [emptyRun(initial.rawQuestion, null, 0)],
    };
  }

  /**
   * 注入 follow-up 处理回调。CLI 主入口在 server 启动后调一次。
   *
   * 若未注入，POST /api/followup 返回 503 followup not configured。
   */
  setOnFollowup(handler: FollowupHandler): void {
    this.onFollowup = handler;
  }

  /**
   * 标记 enhancer 完成、等待用户在 web view 上确认。
   *
   * 返回一个 Promise，等用户在浏览器点击"继续 / 取消"（POST /api/confirm）后 resolve；
   * 用法上调用方应当与 stdin readline 走 Promise.race，谁先响应谁赢。
   *
   * 主动 cancel 此 awaitConfirmation：调 clearPendingConfirmation。
   */
  awaitConfirmation(args: {
    enhancedQuestion: string;
    scene: string;
    sceneSource: string;
  }): Promise<'confirm' | 'cancel'> {
    const t = this.tail();
    t.pendingConfirmation = {
      enhancedQuestion: args.enhancedQuestion,
      scene: args.scene,
      sceneSource: args.sceneSource,
    };
    return new Promise((resolve) => {
      this.pendingConfirmResolver = (d) => {
        t.pendingConfirmation = null;
        this.pendingConfirmResolver = null;
        resolve(d);
      };
    });
  }

  /** 取消未完成的 awaitConfirmation（如 stdin 先回应）。 */
  clearPendingConfirmation(): void {
    const t = this.tail();
    t.pendingConfirmation = null;
    this.pendingConfirmResolver = null;
  }

  private pendingConfirmResolver: ((d: 'confirm' | 'cancel') => void) | null = null;

  /** 测试用：取当前 state 快照 */
  getState(): WebViewState {
    return this.state;
  }

  /**
   * 在 thread 末尾添加新一段 followup run；后续所有 setter 自动作用于这一段。
   *
   * 来自 §followup-rounds：用户在 Web view 提交追问后，POST /api/followup handler 调此函数
   * 把 thread 推进，前端下一轮轮询会拿到 thread.length+1 的状态。
   */
  pushFollowupRun(args: {
    rawQuestion: string;
    parentRunId: string;
    followupDepth: number;
  }): void {
    this.state.thread.push(emptyRun(args.rawQuestion, args.parentRunId, args.followupDepth));
  }

  /** 取末梢 run（所有 setter 作用域） */
  private tail(): WebViewRunState {
    return this.state.thread[this.state.thread.length - 1]!;
  }

  /**
   * 启动 server。返回实际绑定的端口（端口冲突时 ≠ 请求端口）。
   * 绑定失败时抛错。
   */
  async start(): Promise<number> {
    const app = new Hono();

    app.get('/', (c) => {
      // 用最新 state 渲染（首次加载时已经有部分进度，避免空白）
      return c.html(renderWebViewHtml(this.state));
    });

    app.get('/api/state', (c) => {
      return c.json(this.state);
    });

    app.post('/api/confirm', async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }
      const d =
        body !== null && typeof body === 'object'
          ? (body as { decision?: unknown }).decision
          : undefined;
      if (d !== 'confirm' && d !== 'cancel') {
        return c.json({ error: 'decision must be "confirm" or "cancel"' }, 400);
      }
      if (this.pendingConfirmResolver === null) {
        return c.json({ error: 'no pending confirmation' }, 409);
      }
      const resolve = this.pendingConfirmResolver;
      resolve(d);
      return c.json({ ok: true });
    });

    app.post('/api/followup', async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'invalid JSON body' }, 400);
      }
      const q =
        body !== null && typeof body === 'object'
          ? (body as { question?: unknown }).question
          : undefined;
      if (typeof q !== 'string' || q.trim().length === 0) {
        return c.json({ error: 'question (non-empty string) required' }, 400);
      }
      const tail = this.state.thread[this.state.thread.length - 1];
      if (!tail || tail.status === 'running') {
        return c.json({ error: 'current run not yet done' }, 409);
      }
      if (this.onFollowup === null) {
        return c.json({ error: 'followup not configured' }, 503);
      }
      try {
        const newRunId = await this.onFollowup(q);
        return c.json({ runId: newRunId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return c.json({ error: msg }, 500);
      }
    });

    // 试探端口：从配置 port 起，最多 +10
    for (let offset = 0; offset <= 10; offset++) {
      const tryPort = this.state.port + offset;
      try {
        await new Promise<void>((resolve, reject) => {
          const s = serve(
            { fetch: app.fetch, port: tryPort, hostname: '127.0.0.1' },
            (info) => {
              this.actualPort = info.port;
              this.state.port = info.port;
              this.server = s;
              resolve();
            },
          );
          s.on?.('error', reject);
        });
        return this.actualPort;
      } catch {
        // 该端口被占，试下一个
      }
    }
    throw new Error(`web view server: 端口 ${this.state.port}..${this.state.port + 10} 都被占用`);
  }

  /** 优雅关闭 */
  async close(): Promise<void> {
    if (this.server === null) return;
    await new Promise<void>((resolve) => {
      this.server!.close(() => resolve());
    });
    this.server = null;
  }

  /** 当前 URL（start 之后才有效） */
  url(): string {
    return `http://127.0.0.1:${this.actualPort}`;
  }

  // ─── state mutator API（CLI 在事件回调里调用）；全部作用于 thread 末梢 run ───

  setRunId(runId: string): void {
    this.tail().runId = runId;
  }

  setEnhancerStatus(status: 'pending' | 'done'): void {
    this.tail().enhancerStatus = status;
  }

  setScene(scene: string): void {
    this.tail().scene = scene;
  }

  setUserConfirmed(confirmed: boolean): void {
    this.tail().userConfirmed = confirmed;
  }

  setEnhancedQuestion(question: string): void {
    // 用户确认后的 enhanced 问题覆盖原始 rawQuestion 显示，更准确
    const t = this.tail();
    t.enhancedQuestion = question;
    t.rawQuestion = question;
  }

  startRound(round: number, activeAgents: string[]): void {
    this.tail().rounds.push({
      round,
      activeAgents,
      agents: activeAgents.map((agent) => ({ agent, status: 'pending' })),
      done: false,
    });
  }

  recordAgentResult(
    round: number,
    agent: string,
    result: { ok: true; durationMs: number } | { ok: false; error: string },
  ): void {
    const r = this.findRound(round);
    if (!r) return;
    const a = r.agents.find((x) => x.agent === agent);
    if (!a) return;
    if (result.ok) {
      a.status = 'done';
      a.durationMs = result.durationMs;
    } else {
      a.status = 'errored';
      a.error = result.error;
    }
  }

  endRound(round: number): void {
    const r = this.findRound(round);
    if (r) r.done = true;
  }

  setFinal(markdown: string): void {
    const t = this.tail();
    t.finalHtml = marked.parse(markdown, { async: false }) as string;
    t.status = 'done';
  }

  setAborted(reason: string): void {
    const t = this.tail();
    t.status = 'aborted';
    t.abortReason = reason;
  }

  setCancelled(): void {
    this.tail().status = 'cancelled';
  }

  private findRound(round: number): WebViewRoundState | undefined {
    return this.tail().rounds.find((r) => r.round === round);
  }
}

/** Cross-platform "open URL in default browser"（不抛错；失败仅返回 false） */
export async function openInBrowser(url: string): Promise<boolean> {
  const { spawn } = await import('node:child_process');
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
