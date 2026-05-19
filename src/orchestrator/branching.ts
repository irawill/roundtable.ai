import type { ModelConfig } from '../config/schemas/models.js';
import type { SceneConfig } from '../config/schemas/scenes.js';
import { computeParticipants } from '../config/participants.js';

/**
 * Layer 1 + Layer 2 分支逻辑。
 *
 * 来自 §roundtable-orchestrator "状态机驱动（两层分支）" + §scene-system "两层路径分支"
 * + tasks.md §8.3 / §8.3.1-§8.3.7 + 跨阶段约束 #5 设计决策。
 *
 * Layer 1（IDLE 时按 enabled_models.length）：
 *   - == 0 → ABORT_EMPTY
 *   - == 1 → SINGLE_AGENT_DIRECT_INVOKING（跳过 Enhancer）
 *   - >= 2 → ENHANCING
 *
 * Layer 2（BRANCHING_AFTER_CONFIRM，基于 participants 三重交集）：
 *   - >= 2 → ROUND_RUNNING round=1
 *   - == 1 → SINGLE_AGENT_DOWNGRADED_INVOKING
 *   - == 0 → RECOMPUTE_WITH_GENERAL_SCENE（仅一次）→ 二次仍 0 → ABORT_NO_PARTICIPANTS
 */

export type Layer1Decision =
  | { kind: 'abort_empty' }
  | { kind: 'single_agent_direct'; theOnlyAgent: string }
  | { kind: 'enhance' };

/**
 * Layer 1 粗分支。
 *
 * @param enabledModels  models.yaml 中 enabled=true 的 model 名集合
 */
export function decideLayer1(enabledModels: readonly string[]): Layer1Decision {
  if (enabledModels.length === 0) return { kind: 'abort_empty' };
  if (enabledModels.length === 1) {
    return { kind: 'single_agent_direct', theOnlyAgent: enabledModels[0]! };
  }
  return { kind: 'enhance' };
}

export type Layer2Decision =
  | { kind: 'multi_agent_round'; participants: string[] }
  | { kind: 'single_agent_downgraded'; participant: string }
  | { kind: 'recompute_general_scene'; reason: string }
  | { kind: 'abort_no_participants'; reason: string };

/**
 * Layer 2 细分支。
 *
 * 调用前提：用户已确认 enhanced_question（Layer 1 已 ≥ 2 + 已过 ENHANCING + AWAITING_USER_CONFIRM）。
 *
 * @param scene  当前 scene（Enhancer 检测的 或 cli_override 的）
 * @param enabledModels  models.yaml 中 enabled=true 的 model name → ModelConfig
 */
export function decideLayer2(args: {
  scene: SceneConfig;
  enabledModels: ReadonlyMap<string, ModelConfig>;
}): Layer2Decision {
  const result = computeParticipants({
    scene: args.scene,
    enabledModels: args.enabledModels,
  });

  if (result.participants.length >= 2) {
    return { kind: 'multi_agent_round', participants: result.participants };
  }
  if (result.participants.length === 1) {
    return { kind: 'single_agent_downgraded', participant: result.participants[0]! };
  }
  // length === 0
  return {
    kind: 'recompute_general_scene',
    reason: `scene "${args.scene.description}" 的偏好模型与启用列表无交集；fallback 到 general scene`,
  };
}

/**
 * Layer 2 second pass：fallback 到 general scene 后的二次细分支。
 *
 * 来自 §scene-system "fallback 后 participants 仍为 0" Scenario：
 * - >= 2 → multi_agent_round
 * - == 1 → single_agent_downgraded
 * - == 0 → abort_no_participants（**禁止**再次 recompute；仅一次防无限循环）
 */
export function decideLayer2GeneralFallback(args: {
  generalScene: SceneConfig;
  enabledModels: ReadonlyMap<string, ModelConfig>;
}): Exclude<Layer2Decision, { kind: 'recompute_general_scene' }> {
  const result = computeParticipants({
    scene: args.generalScene,
    enabledModels: args.enabledModels,
  });

  if (result.participants.length >= 2) {
    return { kind: 'multi_agent_round', participants: result.participants };
  }
  if (result.participants.length === 1) {
    return { kind: 'single_agent_downgraded', participant: result.participants[0]! };
  }
  return {
    kind: 'abort_no_participants',
    reason:
      'general scene 与启用列表也无交集；请调整 scene 配置或启用主流 model（claude / codex / gemini 之一）',
  };
}
