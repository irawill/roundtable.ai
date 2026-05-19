# 翻译包贡献 — Roundtable.ai

v1 内置 10 个翻译包；除 `en` / `zh-Hans` 外都标为 `community`（社区基线），欢迎贡献修订。

## 当前内置 10 个

| BCP-47 | 名称 | Quality | 主要负责人 |
|---|---|---|---|
| `en` | English | verified | 项目维护者 |
| `zh-Hans` | 简体中文 | verified | 项目维护者 |
| `zh-Hant` | 繁體中文 | community | 待 native speaker |
| `ja` | 日本語 | community | 待 native speaker |
| `ko` | 한국어 | community | 待 native speaker |
| `es` | Español | community | 待 native speaker |
| `fr` | Français | community | 待 native speaker |
| `de` | Deutsch | community | 待 native speaker |
| `pt-BR` | Português (Brasil) | community | 待 native speaker |
| `ru` | Русский | community | 待 native speaker |

## 翻译包格式

每个语言包是一个 JSON 文件，位置：`src/i18n/<tag>.json`。

```json
{
  "$meta": {
    "language": "ja",
    "name": "日本語",
    "quality": "community"
  },
  "common.continue": "続行",
  "common.cancel": "キャンセル",
  "finalizer.section.consensus": "合意部分",
  "finalizer.single_agent.footer": "{agent} のみによる回答（ピアレビューなし）",
  ...
}
```

### 字段约定

- **`$meta`**：包元信息；quality 为 `verified` 或 `community`
- **`<key>`**：扁平字符串 key（点分命名空间，如 `finalizer.section.consensus`）
- **`{placeholder}`**：插值占位符，运行时替换为实际值（如 `{agent}` → `claude`）
- **保留英文**：技术术语 / 公认专有名词 / 错误码 / 版本号保留英文原文（如 `Run ID`、`React`、`BCP-47`）

### 缺失 key 行为

- 翻译包缺某个 key → 自动 fallback 到 `en` 同 key
- 整个翻译包不内置（如用户用 `--lang=vi`）→ fallback 到 `prefs.yaml.language.fallback`（默认 `en`）+ warn

## 贡献流程

### 修订已有 community 包

```bash
# 1. fork 仓库
# 2. 编辑 src/i18n/<tag>.json，修正不准确字段
# 3. 跑测试
npm test

# 4. 提 PR，模板填：
#    - 你是该语言的 native speaker / fluent / 学习者
#    - 改了哪些 key + 原因
#    - 是否参考了已有同类项目的本地化（如 VS Code、GitHub UI）
```

### 升级 community → verified

community 包升级到 verified 需要满足：

1. **至少 2 个 native speaker** 各自审过一遍
2. **CHANGELOG 中显式列出** 升级理由 + reviewer
3. **项目维护者批准**

verified 包后续修改也需要 native speaker review。

### 新增翻译包（v1 不在 10 个内置之外的语言）

v1 内置 10 个语种已定；新语言（如 `vi` / `id` / `hi` / `tr` / `ar`）会随后续 minor 版本加入。如果你想推动：

1. 在 GitHub issue 中开 RFC，说明：用户基数、是否 RTL（ar / he / fa 需独立 milestone）
2. 等维护者批准 RFC 后开 PR：
   - `src/i18n/<tag>.json`（全 key 完整翻译）
   - 更新 `src/shared/lang/packs.ts` 注册新包
   - 更新 `src/shared/lang/alias.ts` 添加常见 alias
   - 更新 README + 本文档

## RTL 语言（v2+ 范围）

RTL 语言（`ar` / `he` / `fa`）需要 ink TUI 单独的双向文本工程，v1 **不**支持，将作为独立 milestone 在 v2 推进。如果你愿意主导这个工作，欢迎在 issue 中讨论。

## 不翻译的内容（运行时强制）

以下内容 Orchestrator 在 prompt 中明确要求 agent **保持原文不翻译**：

- 代码块 / 命令 / shell 片段
- 代码标识符（函数名 / 变量名 / 类名）/ API 名 / 库名 / 文件路径 / URL
- 错误码 / 版本号
- 公认专有名词（React / TypeScript / Kubernetes / CSV / JSON / GraphQL 等）

翻译包中也应当遵循同样约定，不要把 `Run ID` 翻译成本地化术语。

## 错误日志永远英文

`stderr` 的 stack trace / 错误日志**永远英文**（面向开发者），**不**参与 i18n。这是有意的——避免本地化错误信息让维护者 debug 更难。
