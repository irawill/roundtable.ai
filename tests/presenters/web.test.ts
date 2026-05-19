import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../src/shared/event-emitter.js';
import { EventType } from '../../src/shared/event-types.js';
import { startWebView } from '../../src/presenters/web/server.js';
import { WEBVIEW_HTML } from '../../src/presenters/web/html.js';

describe('WEBVIEW_HTML', () => {
  it('单 HTML 含 WebSocket client 与 events log', () => {
    expect(WEBVIEW_HTML).toContain('<!DOCTYPE html>');
    expect(WEBVIEW_HTML).toContain('new WebSocket');
    expect(WEBVIEW_HTML).toContain('Roundtable.ai');
  });

  it('XSS 防护：含 escapeHtml 工具', () => {
    expect(WEBVIEW_HTML).toContain('escapeHtml');
  });
});

describe('startWebView — off 模式', () => {
  it('mode=off 不启动 server', async () => {
    const emitter = new EventEmitter();
    const stderrLines: string[] = [];
    const r = await startWebView({
      mode: 'off',
      emitter,
      stderr: (s) => stderrLines.push(s),
    });
    expect(r.url).toBeNull();
    expect(stderrLines).toEqual([]);
    await r.dispose();
  });
});

describe('startWebView — print_url_only 模式', () => {
  it('mode=print_url_only 启动 server 并返回 url', async () => {
    const emitter = new EventEmitter();
    const r = await startWebView({
      mode: 'print_url_only',
      emitter,
      // 用一个高位端口避免与其他测试冲突
      port: 17421,
    });
    expect(r.url).not.toBeNull();
    expect(r.url).toContain('http://127.0.0.1:');
    await r.dispose();
  });
});

describe('startWebView — 端口冲突自动尝试', () => {
  it('占用 7421 时尝试 7422 等', async () => {
    const emitter = new EventEmitter();
    const a = await startWebView({
      mode: 'print_url_only',
      emitter,
      port: 17500,
    });
    const b = await startWebView({
      mode: 'print_url_only',
      emitter,
      port: 17500,
    });
    expect(a.url).not.toBeNull();
    expect(b.url).not.toBeNull();
    expect(a.url).not.toBe(b.url);
    await a.dispose();
    await b.dispose();
  });
});

describe('startWebView — HTTP / 事件订阅', () => {
  it('HTTP GET / 返回 HTML', async () => {
    const emitter = new EventEmitter();
    const r = await startWebView({
      mode: 'print_url_only',
      emitter,
      port: 17600,
    });
    expect(r.url).not.toBeNull();
    const res = await fetch(r.url!);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Roundtable.ai');
    await r.dispose();
  });

  it('订阅事件总线（emit 不抛错；与 ws 推送语义在集成测覆盖）', async () => {
    const emitter = new EventEmitter();
    const r = await startWebView({
      mode: 'print_url_only',
      emitter,
      port: 17700,
    });
    // emit 几个事件 — 没有 ws 连接也不应抛错
    emitter.emit({
      type: EventType.RoundStarted,
      timestamp: '2026-05-15T10:00:00.000Z',
      run_id: 'r',
      round: 1,
      data: {},
    });
    await r.dispose();
  });
});
