import { createHash } from 'node:crypto';
import type { RolesFile } from '../config/schemas/roles.js';
import type { SceneConfig } from '../config/schemas/scenes.js';

/**
 * Executor 解析 + 4 mode + fallback。
 *
 * 来自 §role-management "executor 必须是当前 run 的 participant" + "executor 的 4 种 mode"
 * + "命令行 override" + tasks.md §11.2 + 跨阶段约束 #11。
 *
 * 4 种 mode：
 * - **fixed**：用 roles.yaml.executor.model；不在 participants → fallback participants[0]
 * - **rotate**：hash(run_uuid + scene_name) % len(participants) 确定性选；永远 ∈ participants
 * - **random**：每次随机选 participant
 * - **per_scene**：从 scene.executor 取 mode + model（scene 内 mode 不允许 per_scene 避免循环）
 *
 * 命令行 --executor=<model> override：
 * - 不在 participants → 启动报错（用户显式意图与运行集合冲突，让用户决定）
 * - 接受 "rotate" / "random" 关键字（详见 §role-management "命令行 override"）
 *
 * 校验时机（调用本模块时）：BRANCHING_AFTER_CONFIRM → ROUND_RUNNING 前。
 */

export class ExecutorResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutorResolveError';
  }
}

export interface ResolveExecutorArgs {
  /** 已经解析好的 roles.yaml */
  roles: RolesFile;
  /** 当前 scene（仅 mode=per_scene 时用 scene.executor） */
  scene: SceneConfig;
  /** Layer 2 三重交集后的 participants */
  participants: readonly string[];
  /** v4 UUID（rotate mode 计算 hash 用） */
  runUuid: string;
  /** scene 名（rotate mode 计算 hash 用） */
  sceneName: string;
  /** CLI --executor 值（可能是 model 名 / "rotate" / "random"） */
  cliExecutorOverride?: string;
}

export interface ExecutorResolveResult {
  /** 最终 executor 名（一定 ∈ participants） */
  executor: string;
  /** 实际生效的 mode（CLI override 时记录 override 后的 mode） */
  mode: 'fixed' | 'rotate' | 'random' | 'per_scene';
  /** 是否触发 fallback（fixed / per_scene 配置的 model 不在 participants） */
  fallbackUsed: boolean;
  /** fallback 触发时记录原始配置的 model 名（便于 meta.json 审计） */
  originalModel?: string;
  /** warning 文案（fallback 时填充） */
  warning?: string;
}

/**
 * 主入口。
 *
 * @throws ExecutorResolveError 命令行 --executor=<model> 不在 participants 集合时
 */
export function resolveExecutor(args: ResolveExecutorArgs): ExecutorResolveResult {
  if (args.participants.length === 0) {
    throw new ExecutorResolveError('participants 集合为空，无法解析 executor');
  }

  // CLI override 优先级最高
  if (args.cliExecutorOverride !== undefined && args.cliExecutorOverride !== '') {
    return resolveCliOverride(args, args.cliExecutorOverride);
  }

  // 按 roles.yaml.executor.mode 分流
  const mode = args.roles.executor.mode;
  switch (mode) {
    case 'fixed':
      return resolveFixed(args, args.roles.executor.model);
    case 'rotate':
      return { executor: rotateExecutor(args), mode: 'rotate', fallbackUsed: false };
    case 'random':
      return { executor: randomExecutor(args.participants), mode: 'random', fallbackUsed: false };
    case 'per_scene':
      return resolvePerScene(args);
  }
}

function resolveCliOverride(
  args: ResolveExecutorArgs,
  override: string,
): ExecutorResolveResult {
  // 关键字 rotate / random
  if (override === 'rotate') {
    return { executor: rotateExecutor(args), mode: 'rotate', fallbackUsed: false };
  }
  if (override === 'random') {
    return { executor: randomExecutor(args.participants), mode: 'random', fallbackUsed: false };
  }

  // 否则视为 model 名，必须 ∈ participants（来自 §role-management "命令行 --executor 与 participants 冲突报错"）
  if (!args.participants.includes(override)) {
    throw new ExecutorResolveError(
      `--executor=${override} 不在本次 participants 集合中（${args.participants.join(' / ')}）；建议改 --executor 或启用 ${override}`,
    );
  }
  return { executor: override, mode: 'fixed', fallbackUsed: false };
}

function resolveFixed(
  args: ResolveExecutorArgs,
  configuredModel: string | undefined,
): ExecutorResolveResult {
  if (configuredModel === undefined) {
    // schema 已保证 fixed mode model 必填；防御性处理
    throw new ExecutorResolveError('roles.yaml.executor.mode=fixed 但 model 缺失');
  }
  if (args.participants.includes(configuredModel)) {
    return { executor: configuredModel, mode: 'fixed', fallbackUsed: false };
  }
  // fallback 到 participants[0]
  const fallback = args.participants[0]!;
  return {
    executor: fallback,
    mode: 'fixed',
    fallbackUsed: true,
    originalModel: configuredModel,
    warning: `executor ${configuredModel} 不在本次 participants 中，已 fallback 到 ${fallback}`,
  };
}

function resolvePerScene(args: ResolveExecutorArgs): ExecutorResolveResult {
  const sceneExecutor = args.scene.executor;
  if (sceneExecutor === undefined) {
    // scene 没配 executor → fallback participants[0]
    const fallback = args.participants[0]!;
    return {
      executor: fallback,
      mode: 'per_scene',
      fallbackUsed: true,
      warning: `roles.executor.mode=per_scene 但 scene "${args.sceneName}" 未配置 executor，已 fallback 到 ${fallback}`,
    };
  }
  // scene 内 mode 不允许 per_scene（schema 已拒绝；防御）
  if (sceneExecutor.mode === 'per_scene') {
    throw new ExecutorResolveError(
      `scene "${args.sceneName}" 内 executor.mode 不允许 per_scene（避免循环）`,
    );
  }
  // 递归一层：scene.executor 视为顶层 roles.executor
  return resolveExecutor({
    ...args,
    roles: { ...args.roles, executor: sceneExecutor },
  });
}

/**
 * Rotate：hash(runUuid + sceneName) % len(participants) 选 participant。
 *
 * 确定性 —— 同一 run_uuid + 同一 scene_name 多次解析结果一致（用于 resume / replay）。
 */
function rotateExecutor(args: ResolveExecutorArgs): string {
  const hash = createHash('sha256').update(`${args.runUuid}|${args.sceneName}`).digest();
  // 取 hash 前 4 字节作为无符号 int32
  const intValue = hash.readUInt32BE(0);
  const idx = intValue % args.participants.length;
  return args.participants[idx]!;
}

function randomExecutor(participants: readonly string[]): string {
  const idx = Math.floor(Math.random() * participants.length);
  return participants[idx]!;
}
