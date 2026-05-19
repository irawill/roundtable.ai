# Claude CLI golden fixtures — 2026-05-14

本目录用于 ClaudeAdapter 解析逻辑的回归测试，按 §agent-adapter "CLI flag 示例不构成长期契约（version probe + golden fixture）" 要求落地。

## 现状（v0.1.0 起步）

`round1.stream-json.txt` 是**结构性占位**，按 Claude CLI `--output-format stream-json` 公开文档的形态构造，包含：

- `type=system` 行（init）
- `type=assistant` 行（intermediate）
- `type=result` 行（含 `result` 字段是 JSON 字符串、`usage` 含 input/output/cached/reasoning 四档 token）

`result` 字段本身是已序列化的 JSON 字符串，内容是 Round 1 agent 输出（仅 answer / key_claims / uncertainty_notes / search_evidence；不含 self_stability / peer_review，与 §roundtable-orchestrator "Round 1 schema 简化" 一致）。

## 后续

阶段 8 集成测落地真实 CLI 跑通后，把脱敏（去掉真实 prompt 与个人信息）的 CLI 输出快照逐字替换本文件，并按 CLI 版本号建新目录。
