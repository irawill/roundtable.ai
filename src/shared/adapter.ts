/**
 * Adapter 接口与配套类型（来自 §agent-adapter "统一 Adapter 接口"）。
 *
 * 命名约定（来自 §agent-adapter）：TS 接口字段名用 camelCase（如 roleSuitability /
 * binaryAvailable）；YAML 配置字段名用 snake_case（如 role_suitability / effort_mapping）。
 * 加载层负责双向映射。
 *
 * 核心约定（auth 与 binary 分离）：binaryAvailable() 与 detectAuthState() MUST 互不嵌套。
 * binary 缺失是不可恢复的（用户没装这个 CLI），auth 问题是可恢复的（用户去另一个终端 login 一次即可）。
 * 两者归一会导致 auth 问题被误当 binary 问题，绕过 auth 恢复流程。
 */

/** 5 级 effort 抽象（来自 §effort-control "5 级 effort 抽象"）。 */
export type EffortLevel = 'none' | 'low' | 'medium' | 'high' | 'max';

/** Auth 状态（来自 §agent-adapter "Auth 状态检测"）。 */
export type AuthState = 'ok' | 'missing' | 'expired' | 'unknown';

/** role_suitability 取值（仅作为 wizard 排序 hint）。 */
export type SuitabilityLevel = 'high' | 'medium' | 'low';

/**
 * Token 用量（来自 §token-usage-tracking "AdapterResult.usage 契约"）。
 *
 * CLI 不暴露 usage 时整个 Usage 对象返回 null（不是字段为 0）；
 * 部分字段可选（cached_input_tokens / reasoning_tokens 视 CLI 是否暴露）。
 * v1 MUST NOT 用本地 tokenizer 估算。
 */
export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  /**
   * 仅 adapter 自身在流式输出中暴露的 provisional usage 时设为 true。
   * TUI 显示时加 `~` 前缀；adapter 不提供 provisional 时不设置此字段。
   */
  provisional?: boolean;
}

/**
 * Adapter invoke 的返回结构（来自 §agent-adapter "AdapterResult 结构"）。
 */
export interface AdapterResult {
  /** 原始输出，debug 用 */
  rawStdout: string;
  /** 已经 Zod 校验的 JSON 对象 */
  parsed: unknown;
  /** 见 §token-usage-tracking；CLI 不暴露时为 null */
  usage: Usage | null;
  /** 端到端调用耗时 */
  durationMs: number;
}

/** Adapter invoke 的入参。 */
export interface AdapterInvokeArgs {
  /** prompt 字符串；按 prompt_transport 通过 stdin / tmpfile / argv 传递 */
  prompt: string;
  /**
   * Zod schema（运行时类型校验），用 unknown 标注以避免引入 zod 在共享类型层。
   * 具体调用方传入相应 schema；adapter 内部用 schema.safeParse 校验 + 失败重试 1 次。
   */
  schema: unknown;
  /** 本次 invoke 使用的 effort 等级 */
  effort: EffortLevel;
  /** 超时（毫秒）；默认 5 分钟，可由 models.<name>.timeout_s 覆盖 */
  timeoutMs: number;
}

/**
 * 统一 Adapter 接口。
 *
 * 每个内置或用户自加 adapter MUST 实现下列方法。加载时缺失任一方法启动时报错。
 */
export interface Adapter {
  /** 唯一标识（如 "claude" / "codex" / "gemini" / 用户自加 "kimi"） */
  readonly name: string;

  /** 能力声明（如 "web_search" / "code_understanding" / "code_execution" / "reasoning_effort"） */
  readonly capabilities: readonly string[];

  /** 角色适配度（仅作为 wizard 排序 hint，不影响默认选择逻辑） */
  readonly roleSuitability: {
    enhancer: SuitabilityLevel;
    executor: SuitabilityLevel;
  };

  /**
   * 仅检查 CLI binary 是否在 $PATH 或 models.<name>.cli_path 中存在。
   * MUST NOT 触发任何鉴权检查（auth 状态另行通过 detectAuthState 检查）。
   */
  binaryAvailable(): Promise<boolean>;

  /**
   * 调 `<cli> --version`，返回版本字符串。
   * 持久化到 meta.json.adapter_versions[name]，CLI 升级时启动 warn。
   */
  version(): Promise<string>;

  /**
   * 检查鉴权状态（可能跑 auth.check_command 或读 auth.check_env）。
   * 双轨 CLI（如 Codex）的 check_command 是权威信号，env 仅作 fast path。
   */
  detectAuthState(): Promise<AuthState>;

  /** 人类可读 re-auth 指引 */
  authInstructions(): string;

  /** 主入口：spawn subprocess，解析输出，返回 AdapterResult */
  invoke(args: AdapterInvokeArgs): Promise<AdapterResult>;
}
