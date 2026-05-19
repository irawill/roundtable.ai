/**
 * TUI presenter 入口。
 *
 * v0.1.0 设计选择：阶段 6 落地 TUI **状态聚合 + headless 文本渲染**，
 * 真正的 ink React 组件树留阶段 7 主入口装配（避免阶段 6 引入 ink runtime 依赖
 * 与单测脆弱性）。
 *
 * Headless 渲染（state.ts + render.ts）已经覆盖：
 * - 事件 → 状态聚合（agent 状态 / round 号 / Enhancer 问题 / 确认页 / 单 agent kind / final markdown）
 * - 文本渲染（带状态图标 / agent 列 / token ticker / 顶部横幅 / Web view URL）
 *
 * 阶段 7 用 ink 把 renderTuiFrame 输出包到 `<Box>` 树即可，逻辑层无需重写。
 *
 * 这样设计的好处：
 * - 单测纯文本对比，不依赖 ink-testing-library
 * - 集成测时 mock 事件流即可验证 TUI 行为
 * - 阶段 7 ink 集成成本低（仅 wrapper）
 */

export { TuiStateAggregator, type TuiSnapshot, type AgentDisplay } from './state.js';
export { renderTuiFrame, renderTokenTicker } from './render.js';
