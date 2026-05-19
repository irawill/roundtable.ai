import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { EventEmitter as RtaiEventEmitter } from '../../shared/event-emitter.js';
import { ALL_EVENTS } from '../../shared/event-emitter.js';
import { WEBVIEW_HTML } from './html.js';

/**
 * Web view server。
 *
 * 来自 §presenters "Web view presenter（默认开启）" + tasks.md §14.1-§14.7。
 *
 * 简化设计（v0.1.0）：
 * - 用 Node 内置 `http` + 手写 WebSocket 握手（避开 hono / ws 包以减少依赖；
 *   spec 留 hono 接口，但 v0.1.0 不强制——hono 已在 package.json 中作为依赖留作 v0.5+ 扩展用）
 * - 单 HTML 嵌入二进制（src/presenters/web/html.ts）
 * - WebSocket 实时推送事件
 * - 端口冲突自动尝试 7421-7430；都失败 warn 不阻塞主流程
 *
 * 三模式（来自 §presenters "Web view presenter"）：
 * - off（默认）：不启动 server
 * - print_url_only：启动 + 显示 URL（TUI on → 顶部状态栏；TUI off → stderr）
 * - on：启动 + 自动 open / xdg-open 打开浏览器
 *
 * URL **不**走 stdout（保持 stdout 仅承载 final.md）。
 */

import { createHash } from 'node:crypto';

export type WebViewMode = 'off' | 'print_url_only' | 'on';

export interface StartWebViewArgs {
  mode: WebViewMode;
  /** 起始端口（默认 7421） */
  port?: number;
  /** 事件总线 */
  emitter: RtaiEventEmitter;
  /** stderr 写函数（默认 process.stderr.write）；URL 在 TUI off 时走此通道 */
  stderr?: (s: string) => void;
}

export interface StartedWebView {
  /** 启动成功的 URL；启动失败为 null */
  url: string | null;
  /** dispose 关闭 server + 取消订阅 */
  dispose: () => Promise<void>;
}

const DEFAULT_PORT_START = 7421;
/** 自动尝试的端口数（spec §presenters 默认 7421-7430 = 10 个）。 */
const PORT_RANGE_COUNT = 10;

/**
 * 启动 Web view server（按 mode 决定行为）。
 *
 * mode=off → 立即返回 url=null + noop dispose。
 *
 * 端口范围：从 args.port（默认 7421）起连续尝试 PORT_RANGE_COUNT 个端口。
 */
export async function startWebView(args: StartWebViewArgs): Promise<StartedWebView> {
  if (args.mode === 'off') {
    return { url: null, dispose: async () => {} };
  }

  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));

  const startPort = args.port ?? DEFAULT_PORT_START;
  const endPort = startPort + PORT_RANGE_COUNT - 1;
  const startResult = await tryStartOnRange(startPort, endPort, args.emitter);
  if (!startResult.ok) {
    stderr(`⚠ Web view: 无可用端口（${startPort}-${endPort} 全被占），已禁用\n`);
    return { url: null, dispose: async () => {} };
  }

  if (args.mode === 'on') {
    // 自动 open / xdg-open（异步，不阻塞）
    openBrowser(startResult.url);
  }
  // print_url_only 模式：URL 由调用方在 TUI 顶部状态栏 / stderr 展示

  return {
    url: startResult.url,
    dispose: async () => {
      startResult.cleanup();
    },
  };
}

interface StartOk {
  ok: true;
  url: string;
  port: number;
  cleanup: () => void;
}

async function tryStartOnRange(
  start: number,
  end: number,
  emitter: RtaiEventEmitter,
): Promise<StartOk | { ok: false }> {
  for (let port = start; port <= end; port++) {
    const result = await tryStart(port, emitter);
    if (result.ok) return result;
  }
  return { ok: false };
}

function tryStart(port: number, emitter: RtaiEventEmitter): Promise<StartOk | { ok: false }> {
  return new Promise((resolve) => {
    // http upgrade 事件的 socket 是 stream.Duplex（适用 TLS / plain TCP）
    const upgradeSockets: Set<import('node:stream').Duplex> = new Set();
    let unsubscribe: () => void = () => {};

    const server: Server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(WEBVIEW_HTML);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/events') {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (typeof key !== 'string') {
        socket.destroy();
        return;
      }
      const accept = createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      upgradeSockets.add(socket);
      socket.on('close', () => upgradeSockets.delete(socket));
      socket.on('error', () => upgradeSockets.delete(socket));
      // 不处理 client → server 消息（v1 单向）；保留 head 写入
      if (head.length > 0) {
        // ignore
      }
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve({ ok: false });
      } else {
        resolve({ ok: false });
      }
    });

    server.listen(port, '127.0.0.1', () => {
      unsubscribe = emitter.subscribe(ALL_EVENTS, (evt) => {
        const frame = encodeWsTextFrame(JSON.stringify(evt));
        for (const sock of upgradeSockets) {
          try {
            sock.write(frame);
          } catch {
            // 单个 socket 错误不阻塞其他
          }
        }
      });
      resolve({
        ok: true,
        url: `http://127.0.0.1:${port}`,
        port,
        cleanup: () => {
          unsubscribe();
          for (const sock of upgradeSockets) {
            try {
              sock.destroy();
            } catch {
              // ignore
            }
          }
          upgradeSockets.clear();
          server.close();
        },
      });
    });
  });
}

/**
 * 编码 WebSocket text frame（仅 server → client；不 mask）。
 *
 * RFC 6455：text frame opcode=0x1，fin=1，no mask。payload length 三种编码（≤125 / 126+2byte / 127+8byte）。
 */
function encodeWsTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // fin=1, opcode=text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function openBrowser(url: string): void {
  const plat = platform();
  let cmd: string;
  let args: string[];
  if (plat === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (plat === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // 自动 open 失败不阻塞；用户仍可手动访问 URL
  }
}
