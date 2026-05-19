import { renderConverged } from './converged.js';
import { renderEscaped } from './escaped.js';
import { renderSingleAgent } from './single-agent.js';
import type { RenderConvergedArgs } from './converged.js';
import type { RenderEscapedArgs } from './escaped.js';
import type { RenderSingleAgentArgs } from './single-agent.js';

/**
 * Finalizer 主入口（三路径分发）。
 *
 * 来自 §finalizer "三条终结路径" + 跨阶段约束 #9 + #10 事件所有权。
 *
 * 核心约定：
 * - Finalizer 是**纯渲染函数**，返回 markdown 字符串
 * - MUST NOT 自己 emit 事件（finalized_* / finalized 由 Orchestrator 单独 emit）
 * - MUST NOT 写文件（final.md 落盘由 Orchestrator 决定，受 --no-persist 约束）
 */

export type FinalizerInput =
  | ({ kind: 'converged' } & RenderConvergedArgs)
  | ({ kind: 'escaped' } & RenderEscapedArgs)
  | ({ kind: 'single_agent' } & RenderSingleAgentArgs);

/**
 * 主入口：按 kind 分发到对应 renderer。返回 markdown 字符串。
 */
export function renderFinal(input: FinalizerInput): string {
  switch (input.kind) {
    case 'converged':
      return renderConverged(input);
    case 'escaped':
      return renderEscaped(input);
    case 'single_agent':
      return renderSingleAgent(input);
  }
}

// 重新导出方便调用方按需引用
export { renderConverged } from './converged.js';
export { renderEscaped } from './escaped.js';
export { renderSingleAgent } from './single-agent.js';
export { buildFormatPromptLine, isKnownOutputFormat, KNOWN_OUTPUT_FORMATS } from './output-format.js';
export { computeConsensus, normalizeClaim } from './normalize.js';
export { buildDisagreementMatrix, renderMatrixMarkdown } from './disagreement-matrix.js';
