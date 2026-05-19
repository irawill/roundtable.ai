import type { ModelConfig } from './schemas/models.js';
import type { SceneConfig } from './schemas/scenes.js';

/**
 * participants 三重交集计算器。
 *
 * 来自 §scene-system "两层路径分支" Requirement：
 *
 *   participants = scene.models
 *                ∩ enabled_models
 *                ∩ { m | m.capabilities ⊇ scene.required_capabilities }
 *
 * 注意：
 * - required_capabilities = [] 时第三个集合等于全集（不排除任何 model）
 * - 返回的 participants 保留 scene.models 的顺序（不按 enabled_models / capabilities 顺序）
 * - 被排除的 model 同时返回（用于 round 1 启动前提示用户 "以下 model 因缺少 [能力名] 被跳过"）
 * - 排除集合按"未在 enabled_models" / "缺少 capability" 分两类，便于差异化 UI 提示
 */

export interface ParticipantsInput {
  scene: Pick<SceneConfig, 'models' | 'required_capabilities'>;
  enabledModels: ReadonlyMap<string, Pick<ModelConfig, 'capabilities'>>;
}

export interface ParticipantsResult {
  /** 三重交集结果，保留 scene.models 的顺序 */
  participants: string[];
  /** 在 scene.models 中但未启用（不在 enabled_models） */
  excludedNotEnabled: string[];
  /** 在 scene.models 中且已启用，但缺 capability */
  excludedMissingCapability: { model: string; missing: string[] }[];
}

/**
 * 计算三重交集 + 排除集合。
 *
 * @param input.scene  含 models 与 required_capabilities
 * @param input.enabledModels  已启用 model 的 map：name → { capabilities }
 */
export function computeParticipants(input: ParticipantsInput): ParticipantsResult {
  const required = new Set(input.scene.required_capabilities ?? []);
  const participants: string[] = [];
  const excludedNotEnabled: string[] = [];
  const excludedMissingCapability: { model: string; missing: string[] }[] = [];

  for (const name of input.scene.models) {
    const model = input.enabledModels.get(name);
    if (!model) {
      excludedNotEnabled.push(name);
      continue;
    }

    if (required.size === 0) {
      participants.push(name);
      continue;
    }

    const have = new Set(model.capabilities);
    const missing: string[] = [];
    for (const cap of required) {
      if (!have.has(cap)) missing.push(cap);
    }
    if (missing.length === 0) {
      participants.push(name);
    } else {
      excludedMissingCapability.push({ model: name, missing });
    }
  }

  return { participants, excludedNotEnabled, excludedMissingCapability };
}
