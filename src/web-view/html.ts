/**
 * Web view HTML 模板。
 *
 * 设计目标：单页应用，前端轮询 /api/state 拿最新进度与 final markdown。
 * 服务端只负责传 JSON + 静态 HTML，markdown → HTML 由 server 用 marked 提前渲染。
 */

export function renderWebViewHtml(initialState: WebViewState): string {
  const initialJson = JSON.stringify(initialState);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roundtable.ai — ${escapeHtml(initialState.thread[0]?.rawQuestion ?? '').slice(0, 60) || 'run'}</title>
<style>
  :root {
    --bg: #0e1014;
    --panel: #151820;
    --panel-2: #1c2029;
    --border: #2a2f3a;
    --text: #e6e8ec;
    --muted: #8a92a3;
    --accent: #7aa2f7;
    --ok: #9ece6a;
    --err: #f7768e;
    --warn: #e0af68;
    --code-bg: #11141a;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.6 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; }
  .topbar { padding: 12px 24px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 16px; position: sticky; top: 0; z-index: 10; }
  .topbar .brand { font-weight: 600; color: var(--accent); }
  .topbar .meta { color: var(--muted); font-size: 12px; }
  .topbar .status { margin-left: auto; padding: 4px 10px; border-radius: 4px; font-size: 12px; }
  .topbar .status.running { background: rgba(122, 162, 247, 0.15); color: var(--accent); }
  .topbar .status.done { background: rgba(158, 206, 106, 0.15); color: var(--ok); }
  .topbar .status.aborted { background: rgba(247, 118, 142, 0.15); color: var(--err); }
  main { max-width: 980px; margin: 0 auto; padding: 24px; }
  .question { background: var(--panel); border-left: 3px solid var(--accent); padding: 12px 16px; border-radius: 4px; margin-bottom: 16px; }
  .question .label { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; }
  .question .body { margin-top: 4px; }
  .progress { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
  .progress h3 { margin: 0 0 8px; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .progress .row { display: flex; gap: 8px; padding: 4px 0; font-size: 13px; align-items: center; }
  .progress .row .icon { width: 16px; text-align: center; }
  .progress .row.ok .icon { color: var(--ok); }
  .progress .row.err .icon { color: var(--err); }
  .progress .row.pending .icon { color: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
  .progress .row .agent { color: var(--text); min-width: 80px; }
  .progress .row .detail { color: var(--muted); font-size: 12px; }
  .final { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 24px; }
  .final h1 { font-size: 22px; margin: 0 0 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .final h2 { font-size: 16px; margin: 24px 0 12px; color: var(--accent); }
  .final h3 { font-size: 14px; margin: 16px 0 8px; }
  .final p { margin: 8px 0; }
  .final code { background: var(--code-bg); padding: 2px 6px; border-radius: 3px; font-family: "SF Mono", Menlo, monospace; font-size: 12px; }
  .final pre { background: var(--code-bg); padding: 12px; border-radius: 4px; overflow-x: auto; border: 1px solid var(--border); }
  .final pre code { background: none; padding: 0; }
  .final ul, .final ol { padding-left: 24px; }
  .final li { margin: 4px 0; }
  .final table { border-collapse: collapse; margin: 12px 0; width: 100%; font-size: 13px; }
  .final th, .final td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; vertical-align: top; }
  .final th { background: var(--panel-2); color: var(--accent); font-weight: 600; }
  .final tr:nth-child(even) td { background: rgba(255,255,255,0.02); }
  .final details { margin: 12px 0; border: 1px solid var(--border); border-radius: 4px; }
  .final details summary { padding: 10px 16px; background: var(--panel-2); cursor: pointer; font-weight: 600; user-select: none; }
  .final details summary:hover { background: rgba(122, 162, 247, 0.08); }
  .final details[open] summary { border-bottom: 1px solid var(--border); }
  .final details > *:not(summary) { padding: 0 16px; }
  .final blockquote { margin: 8px 0; padding: 8px 16px; border-left: 3px solid var(--muted); color: var(--muted); }
  .final em { color: var(--muted); }
  .final hr { border: 0; border-top: 1px solid var(--border); margin: 16px 0; }
  .empty { color: var(--muted); padding: 32px; text-align: center; font-style: italic; }
  .footer { margin-top: 24px; padding: 16px; color: var(--muted); font-size: 12px; text-align: center; }
  .footer code { color: var(--accent); background: var(--code-bg); padding: 2px 6px; border-radius: 3px; }
  .thread-seg { margin-bottom: 32px; padding-bottom: 24px; border-bottom: 1px dashed var(--border); }
  .thread-seg:last-child { border-bottom: none; }
  .thread-seg > details { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; margin-bottom: 8px; }
  .thread-seg > details > summary { padding: 12px 16px; cursor: pointer; color: var(--muted); font-size: 13px; user-select: none; }
  .thread-seg > details > summary:hover { color: var(--text); }
  .thread-seg > details[open] > summary { border-bottom: 1px solid var(--border); color: var(--accent); }
  .thread-seg > details > .final { border-radius: 0 0 6px 6px; border: 0; padding: 16px 24px; }
  .followup-form { margin-top: 24px; background: var(--panel); padding: 16px; border-radius: 6px; border: 1px solid var(--border); }
  .followup-form h3 { margin: 0 0 8px; font-size: 13px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }
  .followup-form textarea { width: 100%; background: var(--code-bg); color: var(--text); border: 1px solid var(--border); padding: 8px; border-radius: 4px; font: 13px/1.5 inherit; resize: vertical; box-sizing: border-box; }
  .followup-form button { margin-top: 8px; padding: 6px 16px; background: var(--accent); color: #0b0d12; border: 0; border-radius: 4px; cursor: pointer; font-weight: 600; }
  .followup-form button:disabled { opacity: 0.5; cursor: not-allowed; }
  .followup-error { margin-top: 8px; color: var(--err); font-size: 12px; }
  .confirm-panel { background: var(--panel); padding: 16px; border-radius: 6px; border: 1px solid var(--accent); margin: 16px 0; }
  .confirm-panel h3 { margin: 0 0 8px; font-size: 13px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }
  .confirm-panel .meta-line { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
  .confirm-panel .enhanced { background: var(--code-bg); padding: 12px; border-radius: 4px; margin-bottom: 12px; white-space: pre-wrap; font-size: 13px; line-height: 1.5; }
  .confirm-panel .actions { display: flex; gap: 8px; }
  .confirm-panel button { padding: 6px 16px; border: 0; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 13px; }
  .confirm-panel button.confirm { background: var(--accent); color: #0b0d12; }
  .confirm-panel button.cancel { background: var(--code-bg); color: var(--text); border: 1px solid var(--border); }
  .confirm-panel button:disabled { opacity: 0.5; cursor: not-allowed; }
  .confirm-error { margin-top: 8px; color: var(--err); font-size: 12px; }
</style>
</head>
<body>
<div class="topbar">
  <span class="brand">Roundtable.ai</span>
  <span class="meta" id="meta"></span>
  <span class="status running" id="status">RUNNING</span>
</div>
<main>
  <div id="thread"></div>
</main>
<div class="footer">
  Local-only view at <code>http://127.0.0.1:${initialState.port}</code> · 关闭终端即停止 server
</div>
<script>
const INITIAL = ${initialJson};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function progressLines(run) {
  const lines = [];
  if (run.enhancerStatus) {
    lines.push({ icon: run.enhancerStatus === 'done' ? '✓' : '·', cls: run.enhancerStatus === 'done' ? 'ok' : 'pending', label: 'Enhancer', detail: run.enhancerStatus === 'done' ? 'scene=' + (run.scene || '?') : 'working…' });
  }
  if (run.userConfirmed === true) {
    lines.push({ icon: '✓', cls: 'ok', label: 'User', detail: 'confirmed enhanced question' });
  } else if (run.userConfirmed === false) {
    lines.push({ icon: '✗', cls: 'err', label: 'User', detail: 'cancelled' });
  }
  for (const r of (run.rounds || [])) {
    lines.push({ icon: '→', cls: 'ok', label: 'Round ' + r.round, detail: 'start (active: ' + (r.activeAgents || []).join(', ') + ')' });
    for (const a of (r.agents || [])) {
      const icon = a.status === 'done' ? '✓' : (a.status === 'errored' ? '✗' : '·');
      const cls = a.status === 'done' ? 'ok' : (a.status === 'errored' ? 'err' : 'pending');
      const detail = a.status === 'done' ? (a.durationMs ? (a.durationMs + 'ms') : 'completed') : (a.status === 'errored' ? (a.error || 'errored') : 'thinking…');
      lines.push({ icon, cls, label: '  ' + a.agent, detail });
    }
    if (r.done) {
      lines.push({ icon: '←', cls: 'ok', label: 'Round ' + r.round, detail: 'done' });
    }
  }
  return lines;
}

function progressNode(run) {
  const wrapper = document.createElement('div');
  wrapper.className = 'progress';
  const h = document.createElement('h3');
  h.textContent = 'Progress';
  wrapper.appendChild(h);
  const rows = document.createElement('div');
  for (const l of progressLines(run)) {
    const div = document.createElement('div');
    div.className = 'row ' + l.cls;
    div.innerHTML = '<span class="icon">' + l.icon + '</span><span class="agent">' + escapeHtml(l.label) + '</span><span class="detail">' + escapeHtml(l.detail) + '</span>';
    rows.appendChild(div);
  }
  wrapper.appendChild(rows);
  return wrapper;
}

function questionNode(run) {
  const q = document.createElement('div');
  q.className = 'question';
  q.innerHTML = '<div class="label">Question</div><div class="body">' + escapeHtml(run.rawQuestion || '(no question)') + '</div>';
  return q;
}

function finalNode(run) {
  const f = document.createElement('div');
  f.className = 'final';
  if (run.finalHtml) {
    f.innerHTML = run.finalHtml;
  } else if (run.status === 'aborted') {
    f.innerHTML = '<div class="empty">运行中止：' + escapeHtml(run.abortReason || '') + '</div>';
  } else if (run.status === 'cancelled') {
    f.innerHTML = '<div class="empty">已取消</div>';
  } else {
    f.innerHTML = '<div class="empty">等待 final 答案…</div>';
  }
  return f;
}

function followupForm() {
  const form = document.createElement('form');
  form.className = 'followup-form';
  form.innerHTML =
    '<h3>追问</h3>' +
    '<textarea name="question" placeholder="基于以上结论继续问…" rows="3"></textarea>' +
    '<div><button type="submit">提问</button></div>' +
    '<div class="followup-error" style="display:none"></div>';
  form.addEventListener('submit', onFollowupSubmit);
  return form;
}

function confirmPanel(run) {
  const pc = run.pendingConfirmation;
  const panel = document.createElement('div');
  panel.className = 'confirm-panel';
  panel.innerHTML =
    '<h3>请确认补全后的问题</h3>' +
    '<div class="meta-line">scene: ' + escapeHtml(pc.scene) + ' (' + escapeHtml(pc.sceneSource) + ')</div>' +
    '<div class="enhanced">' + escapeHtml(pc.enhancedQuestion) + '</div>' +
    '<div class="actions">' +
    '  <button type="button" class="confirm">继续</button>' +
    '  <button type="button" class="cancel">取消</button>' +
    '</div>' +
    '<div class="confirm-error" style="display:none"></div>';
  const errEl = panel.querySelector('.confirm-error');
  const btnConfirm = panel.querySelector('button.confirm');
  const btnCancel = panel.querySelector('button.cancel');
  const sendDecision = async (d) => {
    btnConfirm.disabled = true; btnCancel.disabled = true; errEl.style.display = 'none';
    try {
      const r = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: d }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || ('HTTP ' + r.status));
      }
      setTimeout(() => poll(), 100);
    } catch (err) {
      errEl.textContent = '确认失败：' + (err.message || String(err));
      errEl.style.display = 'block';
      btnConfirm.disabled = false; btnCancel.disabled = false;
    }
  };
  btnConfirm.addEventListener('click', () => sendDecision('confirm'));
  btnCancel.addEventListener('click', () => sendDecision('cancel'));
  return panel;
}

let lastThreadLen = 0;

async function onFollowupSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const ta = form.elements.namedItem('question');
  const errEl = form.querySelector('.followup-error');
  const btn = form.querySelector('button');
  const q = (ta.value || '').trim();
  if (!q) return;
  btn.disabled = true; btn.textContent = '提交中…'; errEl.style.display = 'none';
  try {
    const r = await fetch('/api/followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    // 不刷页；下一次轮询会拿到 thread.length+1 的新 state
    // 强制 1 秒后轮询一次以加快响应
    setTimeout(() => poll(), 200);
  } catch (err) {
    errEl.textContent = '追问失败：' + (err.message || String(err));
    errEl.style.display = 'block';
    btn.disabled = false; btn.textContent = '提问';
  }
}

function renderThread(state) {
  const root = document.getElementById('thread');
  const thread = state.thread || [];
  const lastIdx = thread.length - 1;
  const tail = thread[lastIdx];

  // 顶部 meta + status 走 tail
  if (tail) {
    const meta = tail.runId
      ? 'run ' + tail.runId.slice(0, 8) + ' · scene=' + (tail.scene || '?') + (tail.followupDepth > 0 ? ' · depth=' + tail.followupDepth : '')
      : '';
    document.getElementById('meta').textContent = meta;
    const statusEl = document.getElementById('status');
    statusEl.className = 'status ' + (tail.status || 'running');
    statusEl.textContent = (tail.status || 'running').toUpperCase();
  }

  root.innerHTML = '';
  thread.forEach((run, idx) => {
    const seg = document.createElement('div');
    seg.className = 'thread-seg';
    if (idx < lastIdx) {
      // 历史段折叠
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = '第 ' + (idx + 1) + ' 轮：' + (run.rawQuestion || '').slice(0, 80);
      det.appendChild(sum);
      det.appendChild(finalNode(run));
      seg.appendChild(det);
    } else {
      // tail：展开 question + progress + (confirm-panel?) + final
      seg.appendChild(questionNode(run));
      seg.appendChild(progressNode(run));
      if (run.pendingConfirmation) {
        seg.appendChild(confirmPanel(run));
      }
      seg.appendChild(finalNode(run));
      if (run.status === 'done' || run.status === 'aborted' || run.status === 'cancelled') {
        seg.appendChild(followupForm());
      }
    }
    root.appendChild(seg);
  });

  lastThreadLen = thread.length;
}

renderThread(INITIAL);

async function poll() {
  try {
    const r = await fetch('/api/state');
    if (!r.ok) return;
    const state = await r.json();
    renderThread(state);
  } catch (e) {
    // ignore
  }
  setTimeout(poll, 1000);
}
setTimeout(poll, 1000);
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface WebViewState {
  /** server 端口（start 之后写入） */
  port: number;
  /**
   * thread 按时序排列：thread[0]=root，thread[N-1]=末梢。长度 ≥ 1。
   *
   * 来自 §followup-rounds：多轮追问累积在一个 server 实例的 thread 数组中；
   * 前端把 thread[0..N-2] 折叠为 &lt;details&gt;，thread[N-1] 永远展开。
   */
  thread: WebViewRunState[];
}

export interface WebViewRunState {
  runId: string | null;
  parentRunId: string | null;
  followupDepth: number;
  rawQuestion: string;
  enhancedQuestion: string | null;
  scene: string | null;
  enhancerStatus: 'pending' | 'done' | null;
  userConfirmed: boolean | null;
  rounds: WebViewRoundState[];
  status: 'running' | 'done' | 'aborted' | 'cancelled';
  finalHtml: string | null;
  abortReason: string | null;
  /**
   * Enhancer 完成后、用户尚未确认时填充；用户点击"继续 / 取消"后清空（设回 null）。
   *
   * 来自 §followup-rounds 续做：把 Y/n 确认从 CLI stdin 搬到 web view，stdin / web view 双路 race。
   */
  pendingConfirmation: {
    enhancedQuestion: string;
    scene: string;
    sceneSource: string;
  } | null;
}

export interface WebViewRoundState {
  round: number;
  activeAgents: string[];
  agents: { agent: string; status: 'pending' | 'done' | 'errored'; durationMs?: number; error?: string }[];
  done: boolean;
}
