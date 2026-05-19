import {
  SingleAgentSchema,
  type SingleAgentOutput,
} from '../shared/agent-output-schema.js';
import type { Adapter, EffortLevel } from '../shared/adapter.js';
import type { SceneConfig } from '../config/schemas/scenes.js';
import { buildSingleAgentPrompt } from './round-prompt.js';

/**
 * 单 agent 路径（direct + downgraded 共享）。
 *
 * 来自 §roundtable-orchestrator "单 agent 路径（两种进入方式共享行为）" + tasks.md §9.5.1-§9.5.7
 * + 跨阶段约束 #11 持久化时机。
 *
 * 两种进入方式：
 * - **direct**（Layer 1 触发，enabled_models.length == 1）：
 *   - prompt 用 raw_question
 *   - scene 强制 general
 *   - 跳过 Enhancer / 跳过用户确认页
 *   - meta.json.single_agent_kind = "direct"
 *   - CLI --scene=<x> warn + 忽略
 *
 * - **downgraded**（Layer 2 触发，participants.length == 1）：
 *   - prompt 用 enhanced_question（保留 Enhancer 上下文）
 *   - scene 沿用 Enhancer 检测（或 fallback 后的 general）
 *   - 保留 enhancement_* 事件
 *   - meta.json.single_agent_kind = "downgraded"
 *   - TUI 提示降级
 *
 * 共享行为：
 * - 跳过 round loop / 跳过收敛判定
 * - schema 仅要求 answer（SingleAgentSchema）
 * - 失败重试 1 次 → 仍失败 abort（无圆桌可降级）
 */

export interface InvokeSingleAgentArgs {
  /** direct: raw_question；downgraded: enhanced_question */
  question: string;
  /** Adapter 实例（唯一 participant） */
  adapter: Adapter;
  /** agent 名（仅用于错误信息） */
  agentName: string;
  /** scene（direct 路径强制 general） */
  scene: SceneConfig;
  /** resolved_output_language */
  resolvedOutputLanguage: string;
  /** 本次使用的 effort */
  effort: EffortLevel;
  /** invoke timeout（毫秒） */
  timeoutMs: number;
  /** kind 仅用于 events / meta 标记，**不**影响调用行为 */
  kind: 'direct' | 'downgraded';
}

export type InvokeSingleAgentResult =
  | { ok: true; output: SingleAgentOutput; durationMs: number; usage: import('../shared/adapter.js').Usage | null }
  | { ok: false; error: string; durationMs: number };

/**
 * 调用单 agent 一次，失败重试 1 次。
 *
 * 重试 prompt 携带上次错误简述；仍失败 → ok=false（调用方决定是否 abort 整 run）。
 */
export async function invokeSingleAgent(
  args: InvokeSingleAgentArgs,
): Promise<InvokeSingleAgentResult> {
  const start = Date.now();
  const basePrompt = buildSingleAgentPrompt({
    question: args.question,
    scene: args.scene,
    resolvedOutputLanguage: args.resolvedOutputLanguage,
  });

  // 第一次
  try {
    const result = await args.adapter.invoke({
      prompt: basePrompt,
      schema: SingleAgentSchema,
      effort: args.effort,
      timeoutMs: args.timeoutMs,
    });
    return {
      ok: true,
      output: result.parsed as SingleAgentOutput,
      usage: result.usage,
      durationMs: Date.now() - start,
    };
  } catch (firstErr) {
    // 重试一次
    const retryPrompt =
      basePrompt +
      `\n\n---\n\n上次输出处理失败：${(firstErr as Error).message}\n\n请修正后**仅输出符合 schema 的 JSON**。`;
    try {
      const retry = await args.adapter.invoke({
        prompt: retryPrompt,
        schema: SingleAgentSchema,
        effort: args.effort,
        timeoutMs: args.timeoutMs,
      });
      return {
        ok: true,
        output: retry.parsed as SingleAgentOutput,
        usage: retry.usage,
        durationMs: Date.now() - start,
      };
    } catch (retryErr) {
      return {
        ok: false,
        error: `单 agent [${args.agentName}] 调用重试后仍失败：${(retryErr as Error).message}`,
        durationMs: Date.now() - start,
      };
    }
  }
}
