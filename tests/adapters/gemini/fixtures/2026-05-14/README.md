# Gemini CLI golden fixtures — 2026-05-14

GeminiAdapter 解析逻辑回归测试。按 §agent-adapter version probe + golden fixture 约定。

## 现状（v0.1.0 起步）

`round1.json` 是**结构性占位**：

- Gemini CLI 输出格式当前**无标准化 JSON 协议**，agent 用 pure_json 模式直接输出 JSON 字符串
- **不**含 usage 字段（CLI 当前不暴露 usage_metadata；GeminiAdapter 的 usage.mode = "none"，对应 AdapterResult.usage = null，与 §token-usage-tracking "拿不到 usage 不阻塞" Requirement 一致）

## 后续

阶段 8 真实 CLI 集成测后用脱敏快照替换。若 Gemini CLI 后续暴露 usage_metadata（如新 API 或 streaming usage），同步更新 `models.yaml.gemini.usage` 配置 + 新增 fixture 版本。
