[English](./README.en.md) | **简体中文**

<p align="center">
  <img src="./assets/RoundTable.png" alt="Roundtable.ai" width="200" />
</p>

<h1 align="center">Roundtable.ai</h1>

<p align="center">
  <em>把多家旗舰 AI 通过 CLI 拉到一桌：并行作答 → 多轮交叉评审 → 收敛或诚实分歧。</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@roundtablelabs/cli"><img src="https://img.shields.io/npm/v/@roundtablelabs/cli.svg?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@roundtablelabs/cli.svg?color=blue" alt="license" /></a>
  <a href="https://github.com/irawill/roundtable.ai/stargazers"><img src="https://img.shields.io/github/stars/irawill/roundtable.ai?style=social" alt="GitHub stars" /></a>
  <a href="https://github.com/irawill/roundtable.ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/irawill/roundtable.ai/ci.yml?branch=main&label=CI" alt="CI" /></a>
</p>

> 觉得不错？欢迎在 [GitHub](https://github.com/irawill/roundtable.ai) 上点个 ⭐ Star 支持，让更多人发现它。

**v0.1.0 — npm + npx 起步发布。**

## 是什么

Roundtable.ai 把你日常"同一个问题问 ChatGPT、Claude、Gemini 然后人脑汇总"的流程自动化成一条命令：

```bash
rtai "推荐一款 3000 元档的扫地机器人"
```

→ 并行调用 Claude Code / Codex / Gemini CLI → Enhancer 自动识别场景与补全 → 多轮交叉评审 → 给出**多家共识 / 诚实分歧**的最终答案。

## 安装

```bash
# npx 零安装（推荐先试用）
npx @roundtablelabs/cli "你的问题"

# 全局安装
npm install -g @roundtablelabs/cli
rtai "你的问题"
```

**前置依赖**：

- Node.js >= 22 LTS
- 至少装好以下一家 CLI 并完成登录：
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Codex CLI](https://github.com/openai/codex)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)

Roundtable.ai 不替你管理这些 CLI 的鉴权——它只识别 + 引导你去对应终端 `login`。

## 快速开始

首次运行会自动进入 setup wizard：

```bash
rtai "你的问题"
# Wizard 会：
# 1. 扫描 $PATH 找已装的 claude / codex / gemini
# 2. 询问启用哪些 model（至少 1 个）
# 3. 选 enhancer / executor 角色
# 4. 选输出语言（默认跟随 $LANG）
# 5. 可选给 rtai 加一个 rt 短别名
# 之后继续你的原始问题
```

## Scene 系统

按问题类型自动选用 7 个内置 scene 之一（也可手动 `--scene=xxx`）：

| Scene | 用途 | 偏好模型 | 最少/最多轮 |
|---|---|---|---|
| `general` | 杂类问题（默认 fallback） | claude / codex / gemini | 2–4 |
| `consumer` | 产品推荐 / 选购对比 | claude / codex / gemini（需 web_search） | 3–5 |
| `coding` | 编程 / 调试 / 架构 | claude / codex（需 code_understanding） | 2–3 |
| `research` | 深度调研 / 综述 | claude / gemini / codex（需 web_search） | 3–5 |
| `decision` | 决策辅助 / 利弊权衡 | claude / codex / gemini | 4–6 |
| `creative` | 创意写作 / 文案 | claude / codex / gemini | 2–3 |
| `reasoning` | 逻辑推理 / 数学 / 因果 | claude / codex / gemini | 3–5 |

## 常用命令

```bash
# 主流程
rtai "你的问题"                        # 默认 auto scene
rtai --scene=coding "..."              # 强制 scene
rtai --lang=zh-Hans "..."              # 强制输出语言
rtai --no-tui "..."                    # 关 TUI（pipe 友好）
rtai --no-persist "敏感问题"           # 不落盘
rtai --web-view on "..."               # HTML 预览（自动开浏览器）；off / print_url_only / on

# 历史
rtai history                           # 列表（含 thread 列：↳ <parent> d=<depth>）
rtai history --scene=consumer
rtai history --lang=zh-Hans
rtai show <uuid>                       # 详情
rtai show <uuid> --rounds              # 含每轮每 agent 原始输出
rtai export <uuid> --format=md         # 导出 markdown
rtai history forget <uuid>             # 删除指定 run
rtai history clear                     # 删全部

# 追问（基于上一轮结论继续问；Web view 的"追问"输入框等价）
rtai followup <parent_uuid> "保养上有什么坑？"
rtai followup abc12 "..."              # 短前缀

# 配置
rtai config models list
rtai config models enable claude
rtai config models effort codex high
rtai config roles enhancer claude
rtai config language set zh-Hans
rtai config language list              # 看 alias 表

# 升级
rtai upgrade                           # npm install -g @roundtablelabs/cli@latest
```

## 配置目录

```
~/.config/roundtable.ai/
  models.yaml       # 哪些 model 启用 / version / effort / 自加 adapter
  scenes.yaml       # v1 内置 7 个 scene + 你自定义的
  roles.yaml        # enhancer / executor 角色
  prefs.yaml        # max_rounds / TUI / language / history retain / 等
  adapters.mjs      # 可选：用户自加 JS adapter

~/.local/share/roundtable.ai/runs/<uuid>/
  meta.json
  events.jsonl
  final.md
```

## 文档

- [docs/usage.md](docs/usage.md) — 完整用户操作手册
- [docs/adapter-authoring.md](docs/adapter-authoring.md) — 自加 adapter（YAML / JS）
- [docs/i18n-contributing.md](docs/i18n-contributing.md) — 贡献翻译包

## 设计哲学

- **本地优先**：所有 run 落盘在你机器上，没有云端上传
- **不代你鉴权**：每家 CLI 自己管 login；我们只识别 + 引导
- **确定性收敛判定**：不用第二个 LLM 当 Judge，规则只看结构化字段
- **诚实分歧 > 强行综合**：未收敛时输出共识 + 分歧矩阵 + 各家完整答案
- **零凭据存储**：API key / token 一律不进我们的配置文件
- **多语言双轴**：输出语言 + UI 语言分开；10 个内置翻译包

## 安全 / 隐私

- prompt 走 stdin / tmpfile，不通过 argv 泄漏到 `ps`
- 配置目录 0700 / 文件 0600
- `adapters.mjs` 任意代码 → 首次加载需用户显式信任 + mtime 校验
- `--no-persist` 整个 run 不落盘
- `prefs.history.redact_patterns` 落盘前正则替换敏感字段
- 零遥测（仅可选的 npm registry 升级检查）

## 支持项目

Roundtable.ai 是个人维护的开源项目，目前还在早期。如果它解决了你的某个问题、或者你只是觉得这个思路有意思，可以用下面任何一种方式支持：

- ⭐ **Star 本项目**：在 [GitHub](https://github.com/irawill/roundtable.ai) 上点个 star，是对作者最直接的鼓励，也让更多人能发现它
- 🐛 **报告 bug / 提建议**：[开个 issue](https://github.com/irawill/roundtable.ai/issues)，哪怕只是一句话的反馈也很有用
- 🛠️ **贡献代码**：从修一个错别字到接入一家新的 model CLI 都欢迎；翻译包贡献见 [docs/i18n-contributing.md](docs/i18n-contributing.md)；adapter 贡献见 [docs/adapter-authoring.md](docs/adapter-authoring.md)
- 💬 **告诉一个朋友**：在你的同事群 / 社区 / 社交媒体分享一下，让需要的人能用上

每一个 star、每一条反馈都会让这个项目走得更远。🙏

## License

MIT
