/**
 * Orchestrator 模块入口（barrel export）。
 *
 * 阶段 5 落地的所有 Orchestrator + Finalizer 公共 API；阶段 7 CLI 入口在此组装。
 *
 * 注：本阶段尚未提供"一键运行整个 run"的高级入口（如 runOrchestrator(args) →
 * 自动跑完整 enhancer + round loop + finalizer + 持久化）。理由：
 * - 持久化层在阶段 6 落地
 * - CLI 入口路由在阶段 7 落地
 * - 用户交互（确认页 / Ctrl-C UI）在阶段 6 TUI 落地
 *
 * 阶段 5 范围：提供所有**纯函数 / 类**层级构件，让阶段 7 可用 ~80 行代码组装出主入口。
 * 集成测在阶段 8 统一覆盖。
 */

// 状态机
export { State, StateMachine, isLegalTransition, InvalidTransitionError } from './state-machine.js';

// 分支
export {
  decideLayer1,
  decideLayer2,
  decideLayer2GeneralFallback,
  type Layer1Decision,
  type Layer2Decision,
} from './branching.js';

// Run context（run_id + buffer + 持久化时机）
export { RunContext, type RunContextOptions } from './run-context.js';

// Round loop + prompt
export {
  buildRound1Prompt,
  buildRound2PlusPrompt,
  buildSingleAgentPrompt,
} from './round-prompt.js';
export { runRound, BlacklistTracker, type AgentRoundOutput } from './round-loop.js';

// 校验
export {
  validatePeerReview,
  buildPeerReviewRetrySuffix,
  type PeerReviewValidationResult,
} from './peer-review-validate.js';

// 收敛
export {
  checkConverged,
  disagreementBlocks,
  type CheckConvergedResult,
  type ConvergenceStrictness,
  type AgentRoundState,
} from './convergence.js';

// Executor
export {
  resolveExecutor,
  ExecutorResolveError,
  type ExecutorResolveResult,
} from './executor-resolve.js';

// Single agent
export {
  invokeSingleAgent,
  type InvokeSingleAgentResult,
} from './single-agent.js';

// Active check
export { checkActive, type ActiveCheckResult } from './active-check.js';

// Ctrl-C
export { registerCtrlC, type CtrlCHandler } from './ctrl-c.js';

// 主入口装配
export { runOrchestrator, type RunOrchestratorArgs, type RunResult } from './run.js';
