import type { ModelsFile } from '../config/schemas/models.js';
import type { Adapter } from '../shared/adapter.js';
import { BUILTIN_ADAPTER_NAMES, createBuiltinAdapters } from './builtins/index.js';
import { buildYamlAdapter, YamlAdapterError } from './yaml-loader.js';

/**
 * Adapter Registry。
 *
 * 来自 §agent-adapter "用户自加 adapter — YAML 描述" / "用户自加 adapter — JS adapter（ESM）"
 * + "YAML 与 JS 同名" + tasks.md §6.3。
 *
 * 合并规则：
 * 1. 先注册 3 个内置 adapter（claude / codex / gemini）
 * 2. 遍历 models.yaml 条目：
 *    - 若 name 命中内置 → 跳过（内置已经注册；models.yaml 的额外字段如 enabled / version 由
 *      上层 config 合并器使用，不影响 adapter 注册本身）
 *    - 若 name 是新条目 → 构造 YAML CliAdapter 注册
 * 3. JS adapter（adapters.mjs）注册由 Phase 3 js-loader 单独处理（本注册器不知道 JS）；
 *    同名冲突按 §agent-adapter "YAML 与 JS 同名" 处理：YAML 优先 + warn。js-loader 注入时若 name
 *    已存在 → 跳过 + warn（详见 §js-loader 实现）。
 *
 * 调用方：阶段 5 / 7 Orchestrator 入口在加载 models.yaml 后调用本函数构造 registry。
 */

export interface RegistryOpts {
  /** 解析好的 models.yaml */
  models: ModelsFile;
  /** 上次 run 的 CLI 版本（meta.json.adapter_versions） */
  lastKnownVersions?: Readonly<Record<string, string | null>>;
  /** warn 函数（缺失字段、冲突等） */
  warn?: (msg: string) => void;
}

export interface RegistryResult {
  /** name → adapter 实例 */
  adapters: ReadonlyMap<string, Adapter>;
  /** 注册失败的条目（YAML 字段缺失等）；不阻塞 registry 构造，由调用方决定如何提示 */
  errors: { name: string; message: string }[];
}

/**
 * 构造 Adapter Registry。
 *
 * 不抛错——单个 YAML adapter 字段缺失会写入 errors[]，让用户能看到所有错误而非一条一报。
 */
export function buildRegistry(opts: RegistryOpts): RegistryResult {
  const warn = opts.warn ?? defaultWarn;
  const lastKnownVersions = opts.lastKnownVersions ?? {};
  const adapters = new Map<string, Adapter>();
  const errors: { name: string; message: string }[] = [];

  // 步骤 1：内置 adapter
  const builtins = createBuiltinAdapters({ lastKnownVersions });
  for (const name of BUILTIN_ADAPTER_NAMES) {
    adapters.set(name, builtins[name]);
  }

  // 步骤 2：YAML adapter
  for (const [name, config] of Object.entries(opts.models.models)) {
    // 内置 adapter：models.yaml 的字段（enabled / version / effort）由上层 config 合并器消费，
    // **不**重新构造 adapter（避免覆盖内置 defaults）
    if (adapters.has(name)) {
      continue;
    }

    try {
      const adapter = buildYamlAdapter({
        name,
        config,
        lastKnownVersion: lastKnownVersions[name] ?? null,
      });
      adapters.set(name, adapter);
    } catch (err) {
      if (err instanceof YamlAdapterError) {
        errors.push({ name, message: err.message });
        warn(err.message);
      } else {
        throw err;
      }
    }
  }

  return { adapters, errors };
}

function defaultWarn(msg: string): void {
  // eslint-disable-next-line no-console
  console.warn(msg);
}
