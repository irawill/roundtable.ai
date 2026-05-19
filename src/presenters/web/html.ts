/**
 * Web view 单 HTML 模板。
 *
 * 来自 §presenters "Web view presenter（默认开启）" + tasks.md §14.2。
 *
 * 设计选择（§proposal "Web view 同源 TS"）：v1 单 HTML + vanilla JS（无构建），
 * 整段字符串嵌入二进制——便于分发，避免 Next.js / Vite 等构建工具引入。
 *
 * 前端行为：
 * - 建立 WebSocket 连接到 ws://localhost:<port>/events
 * - 按 event.type 增量更新 UI（每 agent 每 round 卡片 / peer_review 矩阵 / 分歧 timeline）
 * - 顶部状态栏：scene / 当前 round / --no-persist 横幅（如有）
 */

export const WEBVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Roundtable.ai — Live View</title>
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    margin: 0;
    padding: 16px;
    background: #fafafa;
    color: #222;
  }
  h1 { margin: 0 0 8px; font-size: 18px; }
  .header {
    background: #fff;
    padding: 12px;
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    margin-bottom: 16px;
  }
  .banner-no-persist {
    background: #fff3cd;
    border: 1px solid #ffc107;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
    color: #856404;
  }
  .agents { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .agent-card {
    background: #fff;
    padding: 12px;
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .agent-card h3 { margin: 0 0 8px; font-size: 14px; display: flex; align-items: center; gap: 6px; }
  .badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
  }
  .badge-thinking { background: #fff3cd; color: #856404; }
  .badge-done { background: #d4edda; color: #155724; }
  .badge-errored { background: #f8d7da; color: #721c24; }
  pre {
    background: #f5f5f5;
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
    max-height: 240px;
  }
  .events-log {
    background: #fff;
    padding: 12px;
    border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    margin-top: 16px;
    max-height: 200px;
    overflow-y: auto;
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 11px;
  }
  .events-log div { padding: 2px 0; border-bottom: 1px solid #eee; }
  .ticker {
    font-family: 'SF Mono', Menlo, monospace;
    font-size: 12px;
    margin-top: 8px;
  }
</style>
</head>
<body>
<div id="banner-area"></div>
<div class="header">
  <h1>🎲 Roundtable.ai — Live View</h1>
  <div id="run-info">connecting...</div>
  <div class="ticker" id="ticker"></div>
</div>
<div class="agents" id="agents"></div>
<div class="events-log" id="events-log"></div>

<script>
(function() {
  const ws = new WebSocket('ws://' + location.host + '/events');
  const agents = {};
  const runInfo = { scene: '?', round: 0, maxRounds: 0, isSingle: false };

  const $bannerArea = document.getElementById('banner-area');
  const $runInfo = document.getElementById('run-info');
  const $ticker = document.getElementById('ticker');
  const $agentsContainer = document.getElementById('agents');
  const $log = document.getElementById('events-log');

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function logLine(text) {
    const div = document.createElement('div');
    div.textContent = text;
    $log.appendChild(div);
    $log.scrollTop = $log.scrollHeight;
  }

  function renderRunInfo() {
    if (runInfo.isSingle) {
      $runInfo.textContent = 'Scene: ' + runInfo.scene + ' | single agent';
    } else {
      const r = runInfo.maxRounds > 0
        ? 'Round ' + runInfo.round + '/' + runInfo.maxRounds
        : 'Round ' + runInfo.round;
      $runInfo.textContent = 'Scene: ' + runInfo.scene + ' | ' + r;
    }
  }

  function upsertAgent(name) {
    if (!agents[name]) {
      const card = document.createElement('div');
      card.className = 'agent-card';
      card.id = 'agent-' + name;
      card.innerHTML = '<h3>' + escapeHtml(name) + ' <span class="badge badge-thinking" id="badge-' + escapeHtml(name) + '">thinking</span></h3><pre id="head-' + escapeHtml(name) + '"></pre>';
      $agentsContainer.appendChild(card);
      agents[name] = { tokens: null };
    }
  }

  function updateBadge(name, status) {
    const el = document.getElementById('badge-' + name);
    if (!el) return;
    el.className = 'badge badge-' + status;
    el.textContent = status;
  }

  function updateHead(name, head) {
    const el = document.getElementById('head-' + name);
    if (!el) return;
    el.textContent = head;
  }

  function renderTicker() {
    const parts = [];
    let total = null;
    for (const [name, info] of Object.entries(agents)) {
      if (info.tokens === null || info.tokens === undefined) {
        parts.push(name + '=-');
      } else {
        parts.push(name + '=' + info.tokens);
        total = (total ?? 0) + info.tokens;
      }
    }
    parts.push('total=' + (total ?? '-'));
    $ticker.textContent = parts.join('  ');
  }

  ws.addEventListener('open', () => {
    $runInfo.textContent = 'connected, waiting for events...';
  });

  ws.addEventListener('message', (msgEvt) => {
    let evt;
    try { evt = JSON.parse(msgEvt.data); } catch { return; }
    const data = evt.data || {};
    logLine('[' + (evt.type || '?') + ']' + (evt.round !== undefined ? ' r=' + evt.round : '') + ' ' + JSON.stringify(data).slice(0, 200));

    switch (evt.type) {
      case 'enhancement_completed':
        if (typeof data.scene === 'string') runInfo.scene = data.scene;
        renderRunInfo();
        break;
      case 'round_started':
        runInfo.round = evt.round || runInfo.round;
        if (Array.isArray(data.active_agents)) {
          for (const a of data.active_agents) {
            upsertAgent(a);
            updateBadge(a, 'thinking');
          }
        }
        renderRunInfo();
        break;
      case 'agent_responded':
        if (typeof data.agent === 'string') {
          upsertAgent(data.agent);
          updateBadge(data.agent, 'done');
          if (typeof data.raw_head === 'string') updateHead(data.agent, data.raw_head);
          if (data.usage && typeof data.usage.input_tokens === 'number') {
            const tokens = (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) +
              (data.usage.cached_input_tokens || 0) + (data.usage.reasoning_tokens || 0);
            agents[data.agent].tokens = tokens;
            renderTicker();
          }
        }
        break;
      case 'agent_errored':
        if (typeof data.agent === 'string') {
          upsertAgent(data.agent);
          updateBadge(data.agent, 'errored');
          if (typeof data.error === 'string') updateHead(data.agent, data.error);
        }
        break;
      case 'single_agent_started':
        runInfo.isSingle = true;
        if (typeof data.agent === 'string') upsertAgent(data.agent);
        renderRunInfo();
        break;
      case 'finalized':
        logLine('--- run finalized ---');
        break;
      default: break;
    }
  });

  ws.addEventListener('close', () => {
    $runInfo.textContent += ' (disconnected)';
  });
})();
</script>
</body>
</html>
`;
