import { spawn } from 'node:child_process';

/**
 * rtai upgrade + 启动 npm registry 检测。
 *
 * 来自 tasks.md §20.3 §20.4 + §security-privacy "网络与遥测最小化" + §20.5.10。
 *
 * - rtai upgrade：npm 路径调 `npm install -g @roundtablelabs/cli@latest`
 *   单二进制路径占位（v1.0+ 落地 GitHub Releases 下载）
 * - 启动 registry check：异步 GET registry.npmjs.org（非阻塞，结束时温和提示）
 * - prefs.upgrade.check = off 关闭检查
 * - 离线无网络警告（fetch 失败静默）
 */

const NPM_PACKAGE_NAME = '@roundtablelabs/cli';
const REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`;

/**
 * 跑 npm install -g 升级（rtai upgrade 子命令的核心）。
 *
 * @returns Promise<exit code>
 */
export async function runNpmUpgrade(args: {
  /** stdout 写函数 */
  stdout?: (s: string) => void;
  /** stderr 写函数 */
  stderr?: (s: string) => void;
}): Promise<number> {
  const stdout = args.stdout ?? ((s: string) => process.stdout.write(s));
  const stderr = args.stderr ?? ((s: string) => process.stderr.write(s));
  stdout(`→ npm install -g ${NPM_PACKAGE_NAME}@latest\n`);
  return new Promise<number>((resolve) => {
    const child = spawn('npm', ['install', '-g', `${NPM_PACKAGE_NAME}@latest`], {
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      stderr(`✗ npm install 启动失败：${err.message}\n`);
      resolve(1);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

/**
 * 启动时检测 npm registry 最新版本（非阻塞）。
 *
 * 比较当前版本与 registry "latest"；不同时温和提示。
 *
 * @param args.currentVersion  当前 package.json.version
 * @param args.timeoutMs       fetch 超时（默认 3 秒；offline 时静默）
 * @returns Promise<{ hasNewVersion, latest } | null>；null = 检查失败 / 离线
 */
export async function checkRegistryVersion(args: {
  currentVersion: string;
  timeoutMs?: number;
}): Promise<{ hasNewVersion: boolean; latest: string } | null> {
  const timeoutMs = args.timeoutMs ?? 3000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    const latest = typeof body.version === 'string' ? body.version : null;
    if (latest === null) return null;
    return { hasNewVersion: latest !== args.currentVersion, latest };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 启动时检查（异步、非阻塞）。
 *
 * - prefs.upgrade.check=off → 立即返回，不发请求
 * - 检测到新版本 → 在 run 结束时温和提示（stderr）
 *
 * 注：本函数返回一个 promise；调用方应当 fire-and-forget 不 await，
 * run 结束时再 promise.then 取结果显示。
 */
export function startBackgroundUpgradeCheck(args: {
  upgradeCheck: 'on' | 'off';
  currentVersion: string;
}): Promise<string | null> {
  if (args.upgradeCheck !== 'on') return Promise.resolve(null);
  return checkRegistryVersion({ currentVersion: args.currentVersion }).then((r) => {
    if (r === null || !r.hasNewVersion) return null;
    return `ℹ a new version ${r.latest} is available; run \`rtai upgrade\` to update`;
  });
}
