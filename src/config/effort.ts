import type { EffortLevel } from '../shared/adapter.js';
import type { ModelConfig } from './schemas/models.js';
import type { SceneConfig } from './schemas/scenes.js';

/**
 * Effort 4 层解析器。
 *
 * 来自 §effort-control "4 层解析优先级（高 → 低）" Requirement：
 *
 *   1. 命令行 override（--effort=<level> 或 --effort=<model>:<level>,...）
 *   2. Scene 级（scenes.<name>.effort_per_model.<model> 优先于 scenes.<name>.effort）
 *   3. Model 自带默认（models.<name>.effort）
 *   4. Adapter 内置默认 medium
 *
 * 注意：scene 层内 effort_per_model 是子级，**不**算独立第 5 层。
 *
 * Per-model 命令行格式校验（来自 §effort-control "per-model 命令行格式校验"）：
 * --effort=<model>:<level>,<model>:<level>... 每段 model 必须已启用，level 必须合法。
 */

export const EFFORT_LEVELS: readonly EffortLevel[] = ['none', 'low', 'medium', 'high', 'max'];

/** Adapter 内置默认（来自 §effort-control "4 层解析优先级"）。 */
export const ADAPTER_DEFAULT_EFFORT: EffortLevel = 'medium';

/**
 * 命令行解析后的 effort 形态：
 * - "global"：所有 participant 用同一 level
 * - "perModel"：按 model 分别指定（未命中的 model 走下一层）
 * - undefined：未指定，由下层 fallback
 */
export type CliEffort =
  | { kind: 'global'; level: EffortLevel }
  | { kind: 'perModel'; map: ReadonlyMap<string, EffortLevel> }
  | undefined;

export interface EffortResolverInput {
  /** 来自命令行 --effort */
  cli: CliEffort;
  /** 当前 scene（用于读 effort / effort_per_model） */
  scene: Pick<SceneConfig, 'effort' | 'effort_per_model'>;
  /** 当前 model 的配置（用于读 model 自带 effort） */
  modelConfig: Pick<ModelConfig, 'effort'>;
  /** 当前 model 名（用于 cli / scene 的 per-model 匹配） */
  modelName: string;
}

/**
 * 按 4 层优先级解析单个 model 在本次 run 中实际使用的 effort 等级。
 */
export function resolveEffort(input: EffortResolverInput): EffortLevel {
  // Layer 1：命令行 override
  if (input.cli !== undefined) {
    if (input.cli.kind === 'global') return input.cli.level;
    const hit = input.cli.map.get(input.modelName);
    if (hit !== undefined) return hit;
    // perModel 未命中本 model → 继续下一层
  }

  // Layer 2：scene 级
  //   2a：scene.effort_per_model.<model>（子级，优先于 scene.effort）
  //   2b：scene.effort
  const perModel = input.scene.effort_per_model?.[input.modelName];
  if (perModel !== undefined) return perModel;
  if (input.scene.effort !== undefined) return input.scene.effort;

  // Layer 3：Model 自带默认
  if (input.modelConfig.effort !== undefined) return input.modelConfig.effort;

  // Layer 4：Adapter 内置默认
  return ADAPTER_DEFAULT_EFFORT;
}

export class EffortParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EffortParseError';
  }
}

/**
 * 解析命令行 --effort 参数。
 *
 * 接受形态：
 * - "high"（global，所有 participant 同等级）
 * - "claude:max,codex:high"（perModel）
 *
 * 校验：每段必须 <model>:<level> 形式；level ∈ 5 个合法值；model 必须在 enabledModelNames 中。
 *
 * @throws EffortParseError 如果格式或值非法
 */
export function parseCliEffort(raw: string, enabledModelNames: ReadonlySet<string>): CliEffort {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new EffortParseError('--effort 值不能为空');
  }

  // 形态一：单一 level（global）
  if (!trimmed.includes(':') && !trimmed.includes(',')) {
    if (!isEffortLevel(trimmed)) {
      throw new EffortParseError(
        `--effort 值 "${trimmed}" 非法；合法值：${EFFORT_LEVELS.join(' / ')}`,
      );
    }
    return { kind: 'global', level: trimmed };
  }

  // 形态二：perModel
  const map = new Map<string, EffortLevel>();
  for (const segment of trimmed.split(',')) {
    const seg = segment.trim();
    if (seg === '') continue;
    const colon = seg.indexOf(':');
    if (colon <= 0 || colon === seg.length - 1) {
      throw new EffortParseError(
        `--effort 段 "${seg}" 非法；每段必须是 <model>:<level> 形式`,
      );
    }
    const modelName = seg.slice(0, colon).trim();
    const level = seg.slice(colon + 1).trim();
    if (!enabledModelNames.has(modelName)) {
      throw new EffortParseError(`--effort model "${modelName}" 未启用`);
    }
    if (!isEffortLevel(level)) {
      throw new EffortParseError(
        `--effort level "${level}" 非法；合法值：${EFFORT_LEVELS.join(' / ')}`,
      );
    }
    map.set(modelName, level);
  }

  if (map.size === 0) {
    throw new EffortParseError('--effort 未解析出任何 <model>:<level> 段');
  }

  return { kind: 'perModel', map };
}

function isEffortLevel(s: string): s is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(s);
}
