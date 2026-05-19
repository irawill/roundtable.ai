import type { ModelConfig } from '../config/schemas/models.js';
import type { Adapter } from '../shared/adapter.js';
import { CliAdapter, type CliAdapterSpec } from './builtins/cli-adapter.js';

/**
 * YAML adapter loader（用户自加 CLI adapter）。
 *
 * 来自 §agent-adapter "用户自加 adapter — YAML 描述" + tasks.md §6.1。
 *
 * 用户在 models.yaml 添加任意条目（如 `kimi`）+ 填齐字段（type / command / output / auth /
 * capabilities / role_suitability / effort_mapping）即可注册 generic CliAdapter；无需写代码。
 *
 * 本 loader 把单条 ModelConfig 转为 CliAdapterSpec，再构造 CliAdapter 实例。
 *
 * 必填字段（来自 §agent-adapter "YAML 字段缺失" Scenario）：
 * - type
 * - command
 * - output（含 mode 与 json_regex 当 mode=json_extract）
 * - auth（含 check_command 或 check_env 之一）
 * - capabilities
 *
 * 缺失任一字段 → 抛 YamlAdapterError，启动时报错并指出缺失字段。
 */

export class YamlAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlAdapterError';
  }
}

export interface BuildYamlAdapterArgs {
  /** model 名（来自 models.yaml 的 key） */
  name: string;
  /** 该 model 的 config */
  config: ModelConfig;
  /** 上次成功 run 的 CLI 版本（来自 meta.json.adapter_versions[name]） */
  lastKnownVersion?: string | null;
}

/**
 * 把 ModelConfig 转 CliAdapter。
 *
 * @throws YamlAdapterError 必填字段缺失或矛盾
 */
export function buildYamlAdapter(args: BuildYamlAdapterArgs): Adapter {
  const { name, config } = args;
  const missing: string[] = [];

  if (config.type === undefined) missing.push('type');
  if (config.command === undefined || config.command.length === 0) missing.push('command');
  if (config.output === undefined) missing.push('output');
  if (config.auth === undefined) {
    missing.push('auth');
  } else {
    const hasCommand = config.auth.check_command !== undefined && config.auth.check_command !== '';
    const hasEnv = config.auth.check_env !== undefined && config.auth.check_env !== '';
    if (!hasCommand && !hasEnv) {
      missing.push('auth.check_command 或 auth.check_env（至少其一）');
    }
  }
  if (config.capabilities.length === 0) {
    // 允许空 capabilities；但提示用户后续 scene 三重交集可能排除
    // 不算缺失字段
  }

  if (missing.length > 0) {
    throw new YamlAdapterError(
      `YAML adapter "${name}" 字段缺失：${missing.join(' / ')}（详见 §agent-adapter "用户自加 adapter — YAML 描述"）`,
    );
  }

  const [bin, ...rest] = config.command!;
  if (bin === undefined) {
    throw new YamlAdapterError(`YAML adapter "${name}" command 数组为空`);
  }

  const spec: CliAdapterSpec = {
    name,
    command: bin,
    capabilities: config.capabilities,
    roleSuitability: config.role_suitability,
    promptTransport: config.prompt_transport,
    // YAML adapter 的 buildArgs：把 command 数组剩余项 + effort flags 一并拼接
    buildArgs: (effortFlags) => [...rest, ...effortFlags],
    outputMode: config.output!.mode,
    outputJsonRegex: config.output!.json_regex,
    effortMapping: config.effort_mapping,
    authCheckCommand: config.auth!.check_command,
    authCheckEnv: config.auth!.check_env,
    authCommandHint: config.auth!.auth_command_hint,
    stderrExpiredPatterns: config.auth!.stderr_expired_patterns,
    usage: config.usage,
    lastKnownVersion: args.lastKnownVersion ?? null,
  };

  return new CliAdapter(spec);
}
