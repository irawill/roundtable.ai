# Codex CLI golden fixtures — 2026-05-14

CodexAdapter 解析逻辑回归测试。按 §agent-adapter version probe + golden fixture 约定。

## 现状（v0.1.0 起步）

`round1.json` 是**结构性占位**，模拟 `codex exec --json` 输出形态（pure_json）：

- 顶层是 Round 1 agent 输出（answer / key_claims / uncertainty_notes / search_evidence）
- `usage` 字段在顶层（CodexAdapter 用 `usage.mode=json_path` + `jsonPath="usage"` 提取）

## 后续

阶段 8 真实 CLI 集成测后用脱敏快照替换。注意 Codex CLI 输出形态可能在 0.5.0 / 1.0.0 演进；按 §agent-adapter "CLI flag 示例不构成长期契约" 用新版本目录隔离。
