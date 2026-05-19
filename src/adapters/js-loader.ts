import { pathToFileURL } from 'node:url';
import type { Adapter } from '../shared/adapter.js';
import {
  type TrustDecision,
  evaluateAdaptersMjsTrust,
} from '../security/adapters-mjs-trust.js';

/**
 * JS adapter loader（用户自加 ESM）。
 *
 * 来自 §agent-adapter "用户自加 adapter — JS adapter（ESM）" + §security-privacy
 * "自定义 adapter 信任模型" + tasks.md §6.2 / §20.5.4 / §20.5.5。
 *
 * 加载流程：
 * 1. --no-adapters-mjs flag 启用 → 跳过加载（返回 { adapters: [], skipped: true }）
 * 2. evaluateAdaptersMjsTrust 检查：
 *    - absent：返回 { adapters: [], skipped: true }
 *    - unsafe_permissions：拒绝加载 + warn
 *    - needs_confirmation：调 confirmTrust 回调（由上层提供，默认拒绝；wizard 中走 UI 提示）
 *    - trusted：继续加载
 * 3. Node 原生 import() 动态加载（不依赖 tsx）
 * 4. 默认导出（default export）是 Adapter | Adapter[]，注册返回
 * 5. 加载失败 / 类型错误 → warn 但不阻塞主流程
 *
 * 同名冲突（与 YAML adapter）：YAML 优先 + warn（来自 §agent-adapter "YAML 与 JS 同名"）。
 * 本函数返回 adapters[]，registry 合并时按 priority 处理：本函数不主动跳过同名，
 * 由 registry 调用方在合并时决定（YAML 已注册 → JS 跳过 + warn）。
 */

export interface LoadJsAdaptersArgs {
  /** adapters.mjs 路径（来自 ConfigPaths.adaptersMjs） */
  path: string;
  /** CLI flag --no-adapters-mjs */
  skip: boolean;
  /** prefs.yaml.security.adapters_mjs_trusted_mtime */
  currentTrustedMtime: number | null;
  /**
   * 用户确认信任的回调。
   *
   * 调用时机：evaluateAdaptersMjsTrust 返回 needs_confirmation。
   * 返回 true → 加载并把新 mtime 写到 prefs（由调用方落盘）。
   * 返回 false → 跳过加载。
   *
   * 默认（不提供）→ 直接 false（非交互环境保守拒绝）。
   */
  confirmTrust?: (reason: 'first_load' | 'mtime_changed') => Promise<boolean>;
  /** warn 函数 */
  warn?: (msg: string) => void;
}

export interface LoadJsAdaptersResult {
  /** 成功加载的 adapter 实例（已 import 完毕） */
  adapters: Adapter[];
  /** 是否完全跳过加载（--no-adapters-mjs / absent / 用户拒绝信任） */
  skipped: boolean;
  /** 信任评估结果（便于上层把 new mtime 写到 prefs） */
  trustDecision: TrustDecision;
  /** 用户在本次回调中是否确认了信任（true 表示上层应更新 trusted_mtime） */
  trustNewlyConfirmed: boolean;
  /** 加载过程中遇到的可恢复错误 */
  errors: string[];
}

export async function loadJsAdapters(args: LoadJsAdaptersArgs): Promise<LoadJsAdaptersResult> {
  const warn = args.warn ?? defaultWarn;

  if (args.skip) {
    return emptyResult({ kind: 'absent' }, false);
  }

  const trust = evaluateAdaptersMjsTrust({
    path: args.path,
    currentTrustedMtime: args.currentTrustedMtime,
  });

  if (trust.kind === 'absent') return emptyResult(trust, false);
  if (trust.kind === 'stat_error') {
    warn(`adapters.mjs stat 失败：${trust.error}`);
    return emptyResult(trust, false);
  }
  if (trust.kind === 'unsafe_permissions') {
    warn(trust.warning);
    return emptyResult(trust, false);
  }

  let confirmed = false;
  if (trust.kind === 'needs_confirmation') {
    const cb = args.confirmTrust ?? (async () => false);
    confirmed = await cb(trust.reason);
    if (!confirmed) {
      warn(`adapters.mjs 未获信任（${trust.reason}），已跳过加载`);
      return emptyResult(trust, false);
    }
  }

  // trust.kind === 'trusted' 或 needs_confirmation + 用户确认 → 加载
  const adapters: Adapter[] = [];
  const errors: string[] = [];
  try {
    const url = pathToFileURL(args.path).href;
    const mod = (await import(url)) as { default?: unknown };
    const def = mod.default;

    if (def === undefined) {
      errors.push('adapters.mjs 未导出 default（应导出 Adapter 实例或 Adapter[]）');
    } else if (Array.isArray(def)) {
      for (const item of def) {
        if (isAdapterLike(item)) {
          adapters.push(item);
        } else {
          errors.push('adapters.mjs default 数组项不符合 Adapter 接口（缺方法或字段）');
        }
      }
    } else if (isAdapterLike(def)) {
      adapters.push(def);
    } else {
      errors.push('adapters.mjs default 既非 Adapter 也非 Adapter[]');
    }
  } catch (err) {
    errors.push(`import adapters.mjs 失败：${(err as Error).message}`);
  }

  for (const e of errors) warn(e);

  return {
    adapters,
    skipped: false,
    trustDecision: trust,
    trustNewlyConfirmed: confirmed,
    errors,
  };
}

function emptyResult(decision: TrustDecision, trustNewlyConfirmed: boolean): LoadJsAdaptersResult {
  return { adapters: [], skipped: true, trustDecision: decision, trustNewlyConfirmed, errors: [] };
}

function isAdapterLike(v: unknown): v is Adapter {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    Array.isArray(o.capabilities) &&
    typeof o.roleSuitability === 'object' &&
    typeof o.binaryAvailable === 'function' &&
    typeof o.version === 'function' &&
    typeof o.detectAuthState === 'function' &&
    typeof o.authInstructions === 'function' &&
    typeof o.invoke === 'function'
  );
}

function defaultWarn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(msg);
}
