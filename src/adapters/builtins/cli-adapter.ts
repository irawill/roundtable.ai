import type { z } from 'zod';
import type {
  Adapter,
  AdapterInvokeArgs,
  AdapterResult,
  AuthState,
  EffortLevel,
  SuitabilityLevel,
  Usage,
} from '../../shared/adapter.js';
import { binaryAvailable } from '../runtime/binary.js';
import { detectAuthState, matchExpiredPattern } from '../runtime/auth.js';
import { type EffortMapping, translateEffort } from '../runtime/effort.js';
import { type ExtractMode, extractJson } from '../runtime/json-extract.js';
import { spawnAndCollect, type PromptTransport, SpawnError } from '../runtime/spawn.js';
import { extractUsage } from '../runtime/usage.js';
import { compareVersion, probeVersion } from '../runtime/version.js';

/**
 * 通用 CLI Adapter 工厂。
 *
 * 来自 §agent-adapter "统一 Adapter 接口" + "Adapter 调用 5 步骤"。
 *
 * 同一份实现承载：
 * - 内置 adapter（claude / codex / gemini）：由 src/adapters/builtins/*.ts 用 spec 对象构造
 * - 用户自加 YAML adapter（阶段任务 28 落地）：由 models.yaml 条目转 spec 后构造
 *
 * 不承载：用户自加 JS adapter——后者自己实现 Adapter 接口（阶段任务 29）。
 */

export interface CliAdapterSpec {
  /** 唯一标识 */
  name: string;

  /** CLI binary 名（在 $PATH 中查找）或绝对路径 */
  command: string;

  /** 能力声明 */
  capabilities: readonly string[];

  /** 角色适配度 hint */
  roleSuitability: { enhancer: SuitabilityLevel; executor: SuitabilityLevel };

  /**
   * 构造 invoke 的 argv（不含 binary 自身、不含 prompt 自身）。
   *
   * @param effortFlags  translateEffort 翻译后的 CLI flag 数组
   * @returns 完整 argv（如 ["-p", "--effort", "high", "--output-format", "stream-json"]）
   *
   * 注：argv 中**不**含 prompt 字面值；prompt 通过 transport 传递（默认 stdin）。
   */
  buildArgs: (effortFlags: readonly string[]) => string[];

  /** prompt 传递方式；默认 stdin */
  promptTransport?: PromptTransport;

  /** output 解析模式 */
  outputMode: ExtractMode;
  /** json_extract 模式必填 */
  outputJsonRegex?: string;
  /** pure_json 模式可选：从顶层 JSON 的指定字段取 agent 回复（嵌套 JSON 串自动二次解析） */
  outputPureJsonField?: string;

  /** effort_mapping 5 级 → CLI flag 数组 */
  effortMapping: EffortMapping;

  /** auth 检测：check_command（如 "claude doctor"） */
  authCheckCommand?: string;
  /** auth 检测：check_env（如 "OPENAI_API_KEY"，仅作 fast path） */
  authCheckEnv?: string;
  /** auth 命令提示文案（用户面向） */
  authCommandHint: string;
  /** 被动识别 expired 的 stderr 模式 */
  stderrExpiredPatterns?: readonly string[];

  /** usage 提取模式与配置 */
  usage?: {
    mode: 'stream_json' | 'regex' | 'json_path' | 'none';
    regex?: string;
    jsonPath?: string;
  };

  /** version 探测 flag；默认 "--version" */
  versionFlag?: string;

  /**
   * 上次成功 run 的 CLI 版本字符串；本次启动若 probe 出的版本 != 此值则 warn。
   * 由调用方（registry / loader）从 meta.json.adapter_versions[name] 读取后注入；
   * 可为 null 表示无历史记录。
   */
  lastKnownVersion?: string | null;

  /** warn 函数；默认 console.warn（写到 stderr） */
  warn?: (msg: string) => void;
}

/**
 * 通用 CLI Adapter 实例（实现 Adapter 接口）。
 *
 * 调用 5 步骤（来自 §agent-adapter）：
 * 1. translateEffort: 把 effort → CLI flag 数组
 * 2. spawnAndCollect: spawn subprocess，按 transport 传 prompt
 * 3. 等待 exit，按 outputMode 提取 JSON
 * 4. schema.safeParse；失败由上层 validateWithRetry 处理（本类只跑一次）
 * 5. 解析 usage，组装 AdapterResult
 *
 * 注：第 4 步的 retry 由 Orchestrator 层调用 validateWithRetry 包裹两次 invoke 完成，
 * 本 adapter 单次 invoke 只跑一次解析；retry 时上层会用带 retry suffix 的 prompt 再调一次。
 */
export class CliAdapter implements Adapter {
  readonly name: string;
  readonly capabilities: readonly string[];
  readonly roleSuitability: { enhancer: SuitabilityLevel; executor: SuitabilityLevel };

  private readonly spec: CliAdapterSpec;
  private readonly warn: (msg: string) => void;

  constructor(spec: CliAdapterSpec) {
    this.spec = spec;
    this.name = spec.name;
    this.capabilities = spec.capabilities;
    this.roleSuitability = spec.roleSuitability;
    this.warn =
      spec.warn ??
      ((msg: string) => {
        // eslint-disable-next-line no-console
        console.warn(msg);
      });
  }

  async binaryAvailable(): Promise<boolean> {
    return binaryAvailable({ command: this.spec.command });
  }

  async version(): Promise<string> {
    const probe = await probeVersion({
      command: this.spec.command,
      versionFlag: this.spec.versionFlag ?? '--version',
    });
    const current = probe.version ?? '(unknown)';

    // 与上次成功 run 对比，不同则 warn（§agent-adapter "CLI flag 示例不构成长期契约"）
    const warning = compareVersion({
      current: probe.version,
      lastKnown: this.spec.lastKnownVersion ?? null,
      adapterName: this.name,
    });
    if (warning !== null) this.warn(warning);

    return current;
  }

  async detectAuthState(): Promise<AuthState> {
    return detectAuthState({
      checkCommand: this.spec.authCheckCommand,
      checkEnv: this.spec.authCheckEnv,
    });
  }

  authInstructions(): string {
    return this.spec.authCommandHint;
  }

  async invoke(args: AdapterInvokeArgs): Promise<AdapterResult> {
    // 步骤 1：effort → flag 数组
    const translated = translateEffort(this.spec.effortMapping, args.effort);
    if (translated.warning !== undefined) this.warn(`[${this.name}] ${translated.warning}`);

    // 步骤 2：构造 argv，spawn
    const argv = this.spec.buildArgs(translated.flags);
    const spawnResult = await spawnAndCollect({
      command: this.spec.command,
      args: argv,
      prompt: args.prompt,
      transport: this.spec.promptTransport ?? 'stdin',
      timeoutMs: args.timeoutMs,
    });

    // 步骤 3：检查 exit / stderr，提取 JSON
    if (spawnResult.timedOut) {
      throw new InvokeError(`[${this.name}] invoke 超时 (${args.timeoutMs} ms)`, spawnResult);
    }
    if (spawnResult.exitCode !== 0) {
      // 被动识别 expired
      if (
        this.spec.stderrExpiredPatterns &&
        matchExpiredPattern(spawnResult.stderr, this.spec.stderrExpiredPatterns)
      ) {
        throw new InvokeError(
          `[${this.name}] auth expired (stderr 匹配 expired pattern)`,
          spawnResult,
          { authExpired: true },
        );
      }
      throw new InvokeError(
        `[${this.name}] invoke 退出码 ${spawnResult.exitCode}：${spawnResult.stderr.slice(0, 500)}`,
        spawnResult,
      );
    }

    const extract = extractJson(spawnResult.stdout, {
      mode: this.spec.outputMode,
      jsonRegex: this.spec.outputJsonRegex,
      pureJsonField: this.spec.outputPureJsonField,
    });
    if (!extract.ok) {
      throw new InvokeError(`[${this.name}] JSON 提取失败：${extract.error}`, spawnResult);
    }

    // 步骤 4：Schema 校验由上层 validateWithRetry 包裹（本 adapter 单次 invoke 只跑一次）。
    // 这里仅 safeParse 一次；上层在失败时构造带 retry suffix 的新 prompt 再调 invoke()。
    const parsed = args.schema as z.ZodTypeAny;
    const validated = parsed.safeParse(extract.result.parsed);
    if (!validated.success) {
      throw new InvokeError(
        `[${this.name}] schema 校验失败：${validated.error.issues
          .map((iss) => `${iss.path.map(String).join('.')}: ${iss.message}`)
          .join('; ')}`,
        spawnResult,
        { schemaError: validated.error },
      );
    }

    // 步骤 5：usage 提取 + 组装 AdapterResult
    const usage: Usage | null = extractUsage({
      mode: this.spec.usage?.mode,
      stdout: spawnResult.stdout,
      stderr: spawnResult.stderr,
      parsed: extract.result.parsed,
      streamUsage: extract.result.streamUsage,
      jsonPath: this.spec.usage?.jsonPath,
      regex: this.spec.usage?.regex,
    });

    return {
      rawStdout: spawnResult.stdout,
      parsed: validated.data,
      usage,
      durationMs: spawnResult.durationMs,
    };
  }
}

/**
 * Invoke 错误：携带 spawn 上下文，便于上层重试与 ERRORED 决策。
 */
export class InvokeError extends Error {
  readonly spawnResult?: unknown;
  readonly authExpired?: boolean;
  readonly schemaError?: unknown;

  constructor(
    message: string,
    spawnResult?: unknown,
    extra?: { authExpired?: boolean; schemaError?: unknown },
  ) {
    super(message);
    this.name = 'InvokeError';
    this.spawnResult = spawnResult;
    this.authExpired = extra?.authExpired;
    this.schemaError = extra?.schemaError;
  }
}

// 让 TS 在 cli-adapter.ts 中能引用 SpawnError 但不导出冗余
export { SpawnError };

// 让上层取默认 effort
export const DEFAULT_EFFORT: EffortLevel = 'medium';
