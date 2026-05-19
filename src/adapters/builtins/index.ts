import type { Adapter } from '../../shared/adapter.js';
import { createClaudeAdapter } from './claude.js';
import { createCodexAdapter } from './codex.js';
import { createGeminiAdapter } from './gemini.js';

/**
 * 3 个内置 adapter 工厂入口。
 *
 * 来自 §agent-adapter "内置 3 个 adapter" + tasks.md §5.4。
 *
 * 调用方（registry）传入 lastKnownVersions 映射，本工厂注入到对应 adapter 用于
 * "CLI 升级 warn"（详见 §agent-adapter "CLI flag 示例不构成长期契约（version probe + golden fixture）"）。
 */
export interface BuiltinFactoryOpts {
  lastKnownVersions?: Readonly<Record<string, string | null>>;
}

/** 内置 adapter 名（用于 wizard / registry 顺序）。 */
export const BUILTIN_ADAPTER_NAMES = ['claude', 'codex', 'gemini'] as const;
export type BuiltinAdapterName = (typeof BUILTIN_ADAPTER_NAMES)[number];

/**
 * 构造全部 3 个内置 adapter 实例。
 *
 * @param opts.lastKnownVersions  各 adapter 上次成功 run 的版本（来自 meta.json.adapter_versions）
 */
export function createBuiltinAdapters(opts: BuiltinFactoryOpts = {}): Record<
  BuiltinAdapterName,
  Adapter
> {
  const v = opts.lastKnownVersions ?? {};
  return {
    claude: createClaudeAdapter({ lastKnownVersion: v.claude ?? null }),
    codex: createCodexAdapter({ lastKnownVersion: v.codex ?? null }),
    gemini: createGeminiAdapter({ lastKnownVersion: v.gemini ?? null }),
  };
}

export { createClaudeAdapter, createCodexAdapter, createGeminiAdapter };
