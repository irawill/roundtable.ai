import { afterEach, describe, expect, it } from 'vitest';
import { WebViewServer } from '../../src/web-view/server.js';

describe('WebViewServer thread state', () => {
  it('初始 thread 长度 1，含 root run', () => {
    const s = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    const state = s.getState();
    expect(state.thread).toHaveLength(1);
    expect(state.thread[0]!.rawQuestion).toBe('Q');
    expect(state.thread[0]!.status).toBe('running');
    expect(state.thread[0]!.parentRunId).toBeNull();
    expect(state.thread[0]!.followupDepth).toBe(0);
  });

  it('pushFollowupRun 加新段、切 tail；setter 作用于新 tail', () => {
    const s = new WebViewServer({ port: 0, rawQuestion: 'Q1' });
    s.setFinal('F1');
    expect(s.getState().thread[0]!.status).toBe('done');
    s.pushFollowupRun({ rawQuestion: 'Q2', parentRunId: 'pid', followupDepth: 1 });
    const state = s.getState();
    expect(state.thread).toHaveLength(2);
    expect(state.thread[1]!.rawQuestion).toBe('Q2');
    expect(state.thread[1]!.status).toBe('running');
    expect(state.thread[1]!.parentRunId).toBe('pid');
    expect(state.thread[1]!.followupDepth).toBe(1);
  });

  it('startRound 仅作用于 tail run', () => {
    const s = new WebViewServer({ port: 0, rawQuestion: 'Q1' });
    s.setFinal('F1');
    s.pushFollowupRun({ rawQuestion: 'Q2', parentRunId: 'pid', followupDepth: 1 });
    s.startRound(1, ['claude']);
    expect(s.getState().thread[0]!.rounds).toHaveLength(0);
    expect(s.getState().thread[1]!.rounds).toHaveLength(1);
  });

  it('setRunId / setScene / setEnhancerStatus 等 setter 作用于 tail', () => {
    const s = new WebViewServer({ port: 0, rawQuestion: 'Q1' });
    s.setFinal('F1');
    s.setRunId('first');
    s.pushFollowupRun({ rawQuestion: 'Q2', parentRunId: 'first', followupDepth: 1 });
    s.setRunId('second');
    s.setScene('coding');
    expect(s.getState().thread[0]!.runId).toBe('first');
    expect(s.getState().thread[1]!.runId).toBe('second');
    expect(s.getState().thread[1]!.scene).toBe('coding');
    expect(s.getState().thread[0]!.scene).toBeNull();
  });

  it('setAborted 仅 mutate tail', () => {
    const s = new WebViewServer({ port: 0, rawQuestion: 'Q1' });
    s.setFinal('F1');
    s.pushFollowupRun({ rawQuestion: 'Q2', parentRunId: 'p', followupDepth: 1 });
    s.setAborted('test reason');
    expect(s.getState().thread[0]!.status).toBe('done');
    expect(s.getState().thread[1]!.status).toBe('aborted');
    expect(s.getState().thread[1]!.abortReason).toBe('test reason');
  });
});

describe('POST /api/followup', () => {
  let server: WebViewServer | null = null;

  afterEach(async () => {
    if (server !== null) {
      await server.close();
      server = null;
    }
  });

  it('tail.status=running 时返回 409', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    await server.start();
    const r = await fetch(server.url() + '/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Q2' }),
    });
    expect(r.status).toBe(409);
  });

  it('缺 question 字段返回 400', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    server.setFinal('F');
    server.setOnFollowup(async () => 'new-id');
    await server.start();
    const r = await fetch(server.url() + '/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(r.status).toBe(400);
  });

  it('未配置 onFollowup 返回 503', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    server.setFinal('F');
    await server.start();
    const r = await fetch(server.url() + '/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Q2' }),
    });
    expect(r.status).toBe(503);
  });

  it('正常路径返回 200 + new runId', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    server.setFinal('F');
    let called = 0;
    let receivedQ = '';
    server.setOnFollowup(async (question) => {
      called++;
      receivedQ = question;
      return 'new-run-id-123';
    });
    await server.start();
    const r = await fetch(server.url() + '/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Q2' }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { runId: string };
    expect(j.runId).toBe('new-run-id-123');
    expect(called).toBe(1);
    expect(receivedQ).toBe('Q2');
  });
});

describe('POST /api/confirm', () => {
  let server: WebViewServer | null = null;

  afterEach(async () => {
    if (server !== null) {
      await server.close();
      server = null;
    }
  });

  it('无 pending 时返回 409', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    await server.start();
    const r = await fetch(server.url() + '/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'confirm' }),
    });
    expect(r.status).toBe(409);
  });

  it('非法 decision 返回 400', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    await server.start();
    void server.awaitConfirmation({ enhancedQuestion: 'EQ', scene: 'general', sceneSource: 'auto' });
    const r = await fetch(server.url() + '/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'maybe' }),
    });
    expect(r.status).toBe(400);
    server.clearPendingConfirmation();
  });

  it('awaitConfirmation 在 POST /api/confirm 后 resolve confirm', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    await server.start();
    const promise = server.awaitConfirmation({
      enhancedQuestion: 'EQ',
      scene: 'consumer',
      sceneSource: 'auto',
    });
    // tail.pendingConfirmation 应已写入
    expect(server.getState().thread[0]!.pendingConfirmation).toEqual({
      enhancedQuestion: 'EQ',
      scene: 'consumer',
      sceneSource: 'auto',
    });
    const r = await fetch(server.url() + '/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'confirm' }),
    });
    expect(r.status).toBe(200);
    await expect(promise).resolves.toBe('confirm');
    expect(server.getState().thread[0]!.pendingConfirmation).toBeNull();
  });

  it('cancel 后 awaitConfirmation resolve cancel', async () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    await server.start();
    const promise = server.awaitConfirmation({
      enhancedQuestion: 'EQ',
      scene: 'general',
      sceneSource: 'auto',
    });
    await fetch(server.url() + '/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'cancel' }),
    });
    await expect(promise).resolves.toBe('cancel');
  });

  it('clearPendingConfirmation 主动清空状态', () => {
    server = new WebViewServer({ port: 0, rawQuestion: 'Q' });
    void server.awaitConfirmation({ enhancedQuestion: 'EQ', scene: 'general', sceneSource: 'auto' });
    expect(server.getState().thread[0]!.pendingConfirmation).not.toBeNull();
    server.clearPendingConfirmation();
    expect(server.getState().thread[0]!.pendingConfirmation).toBeNull();
  });
});
