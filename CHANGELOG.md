# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] — 2026-05-15

**首次发布**。把"同一个问题问 ChatGPT / Claude / Gemini 然后人脑汇总"的流程自动化成本地 CLI。

### Added

#### 核心能力

- **多 agent 圆桌讨论**：并行调用 Claude Code / Codex / Gemini CLI；多轮交叉评审；确定性收敛判定（无 LLM Judge）；三轨终结（多 agent 收敛 / 多 agent 未收敛 / 单 agent direct + downgraded）
- **Question Enhancer**：单次 LLM 调用同时完成 scene 识别 + 自动补全 + 反问 ≤ 3 + 语言检测
- **Scene 系统**：7 个内置 scene（`general` / `consumer` / `coding` / `research` / `decision` / `creative` / `reasoning`）+ 用户自定义；两层路径分支（Layer 1 按启用 model 数；Layer 2 按 `scene.models ∩ enabled ∩ capabilities` 三重交集）
- **Adapter 抽象**：3 内置 adapter（Claude / Codex / Gemini）+ YAML 描述自加 + JS ESM 自加（`.mjs`）
- **Effort 5 级抽象**：`none` / `low` / `medium` / `high` / `max`；4 层解析优先级（命令行 > scene > model > adapter 默认）
- **Token usage 追踪**：仅统计 token 不算金额；TUI 实时 ticker；收敛后 summary table；二维归档到 `meta.json`
- **多语言双轴**：输出语言 + UI 语言双轴；10 个内置翻译包（`en` / `zh-Hans` verified；其余 8 个 community）；三层语言概念（`requested_output` / `resolved_output` / `resolved_ui`）+ `system_language` 启动锚点 + `provisional_ui_language` 早期渲染
- **持久化 / History**：`runs/<uuid>/{meta.json, events.jsonl, final.md}`；`rtai history` 列表（含 `--scene` / `--lang` 过滤）；`rtai show <uuid>` 详情；`rtai resume <uuid>` 恢复；`rtai export --format=md`；retain 策略（unlimited / last_N / ttl_Ndays）
- **Setup Wizard**：首次启动自动触发；PATH 扫描已知 CLI；model 启用流程；角色选择；语言选择；`rtai setup` 重跑入口；`rtai config` scriptable subcommand 全套
- **命令别名**：默认 npm bin `rtai`；可选 `rt` 短别名（wizard 引导，PATH stat + rc 文件 grep + marker 三步检测，避免 shell alias 误判）；`rtai` 冲突时主名兜底（`rta` / `rtab` / `rdt` / 自定义）；fish / nushell 各自语法；Windows 跳过自动写入

#### 安全 / 隐私

- prompt 走 stdin pipe 默认，避免 argv 泄漏给 `ps`
- 配置目录 0700 / 文件 0600；启动权限校验 warn
- `adapters.mjs` 信任模型（首次加载提示 + mtime 校验 + `--no-adapters-mjs` 跳过 + 权限位拒绝）
- `--no-persist` 全路径不落盘
- `prefs.history.redact_patterns` 落盘前正则替换 `[REDACTED]`
- `rtai history forget` / `rtai history clear`
- 错误日志仅 `[run_id=...] adapter=... error=...`，不含 prompt 内容
- 零凭据存储；零遥测（仅可选的 npm registry 升级检查）

#### Presenters

- **stdout**：始终仅 run 完成后输出 final.md（无论 TUI on/off / verbosity）；保证 `rtai "..." > out.md` 在任何配置下都纯净
- **TUI**：默认开启；左右分栏 + 底部 token ticker + 顶部状态栏（`--no-persist` 横幅 / Web view URL）；ink 渲染（v0.1.0 用 headless 文本渲染，ink React 组件树装配延后到后续版本）
- **Web view**：默认 off；`print_url_only` / `on` 三模式；hono server（v0.1.0 用 Node 内置 http + 手写 WebSocket）；单 HTML + vanilla JS + WebSocket 实时推送；端口 7421-7430 自动尝试

#### CLI

- `rtai "<question>"` 主流程
- `rtai setup` / `rtai config <subcommand>` / `rtai history` / `rtai show` / `rtai resume` / `rtai export` / `rtai upgrade`
- 完整 flags：`--scene` / `--lang` / `--ui-lang` / `--effort`（含 per-model 形式）/ `--enhancer` / `--executor` / `--no-tui` / `--no-persist` / `--no-adapters-mjs` / `--verbose` / `--quiet`
- 启动时异步 npm registry 新版本检测（非阻塞 + 可关闭）

### Tech Stack

- TypeScript 5.x（strict mode）
- Node.js 22+ LTS
- `zod` 4.x（schema 校验）
- `commander` 14.x（CLI 解析）
- `ink` 7.x + `ink-spinner` + `ink-table`（TUI；v0.1.0 暂用 headless 渲染）
- `yaml` 2.x（配置加载）
- `hono` 4.x（保留依赖，v0.1.0 用 Node http 实装；v0.5+ 可升级）
- `vitest` 4.x（测试）
- `tsup` 8.x（构建）
- `@biomejs/biome` 2.x（lint / format）

### Distribution

- **npm + npx**（本次发布渠道）
- v0.5：Homebrew tap（formula 名 TBD；占位 `scripts/release-homebrew.sh`）
- v1.0：单二进制（`bun build --compile` 多平台；占位 `scripts/build-binary.sh`）

### Known Limitations (v0.1.0)

- 端到端真实 CLI 集成测需用户在本地或 CI 装齐 claude / codex / gemini CLI + 鉴权
- TUI 的 ink React 组件树装配延后到后续 patch（v0.1.0 用 stdout / stderr 替代）
- `rtai resume` 重建状态成功但 round loop 续跑接入延后到 v0.1.1
- 部分 community 翻译包待 native speaker review（详见 `docs/i18n-contributing.md`）
- 内置 7 个 scene 的 prompt 文案逐字稳定，未来修改视为破坏性变更
