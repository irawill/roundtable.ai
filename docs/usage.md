# Usage — Roundtable.ai

完整用户操作手册。本文档假设你已经走完一次 `rtai setup` 并启用了至少 1 个 model。

## 基本用法

```bash
rtai "你的问题"
```

- **v0.1.0 进度走 stderr**（无论 prefs.ui.tui 怎么配）：Enhancer 工作 / scene 识别 / 用户确认 / 每轮起止 / 每 agent 完成都会打一行短状态。真正的 ink 交互式 TUI（agent 状态卡 / token ticker）留 v0.2.0
- run 完成后 **stdout 一次性输出 final.md**（pipe 友好）；进度行始终在 stderr，不会和 final 混
- 所有 run 落盘到 `~/.local/share/roundtable.ai/runs/<uuid>/`（除非 `--no-persist`）
- **预期时长**：consumer / research / decision 等 3-5 轮 scene + 3 个 agent 通常 5-15 分钟；看到进度行不动可能是单个 agent 在 web_search，正常

## 常见 scene 例子

### consumer（购买决策）

```bash
rtai "推荐一款 3000 元档的扫地机器人"
```

Wizard 通过 `consumer` scene 识别（confidence ≥ 0.8）→ 3 个 agent 用 web_search 找当前在售型号 → 3-5 轮交叉评审 → 给出对比表 + 推荐。

### coding（编程）

```bash
rtai "React 的 useEffect 怎么写 cleanup？"
```

`coding` scene：仅 claude + codex 参与；strict 收敛档；2-3 轮；输出含代码块。

### decision（战略选择）

```bash
rtai "我们应该用 monorepo 还是 multirepo？团队 8 人，3 个独立产品。"
```

`decision` scene：loose 收敛档（允许 reasoning 分歧）；4-6 轮；输出含 pros/cons。

### research（深度调研）

```bash
rtai "总结一下 2025 年下半年 AI Agent 框架的主要 camp"
```

`research` scene：3 agent 用 web_search；输出含引用源。

## 关键 flags

| Flag | 作用 |
|---|---|
| `--scene=<name>` | 强制 scene；仍跑 Enhancer 做补全 + 反问 + 语言检测 |
| `--lang=<tag>` | 输出语言；接受 `auto` / `system` / BCP-47 / alias（如 `简中`） |
| `--ui-lang=<tag>` | UI 语言；接受 `system` / `match_output` / BCP-47 |
| `--effort=<spec>` | 单值 `high` 或 per-model `claude:max,codex:high` |
| `--enhancer=<model>` | 临时换 enhancer |
| `--executor=<spec>` | 临时换 executor（`<model>` / `rotate` / `random`） |
| `--no-tui` | 关 TUI；中间进度走 stderr；适合 `rtai "..." > out.md` |
| `--no-persist` | 整个 run 不落盘；`rtai resume` 不可用 |
| `--no-adapters-mjs` | 跳过加载 `~/.config/roundtable.ai/adapters.mjs` |
| `--verbose` / `--quiet` | TUI / stderr 详细度（stdout 永远只出 final.md） |
| `--web-view=<mode>` | HTML 预览：`off`（仅 stderr 进度）/ `print_url_only`（启动 server 打印 URL）/ `on`（默认，启动 + 自动开浏览器）；覆盖 `prefs.ui.web_view` |

## Web view（HTML 预览）

```bash
# 启动并自动开浏览器（推荐——markdown 在 final.md 长且不好读，HTML 折叠 + 分歧矩阵卡片可读性高）
rtai --web-view=on "推荐一款扫地机器人"

# 仅启动 + 打印 URL（远程 SSH / 自己手动开浏览器）
rtai --web-view=print_url_only "..."

# 永久关闭（修 prefs.yaml，默认即 on）：
#   ui:
#     web_view: off
#   或显式只打印 URL：
#     web_view: print_url_only
```

特性：
- 实时进度：Enhancer 状态 / 用户确认 / 每轮每 agent thinking → done / 最终 final
- `<details>` 折叠：「各家完整答案」段默认折叠（终端展平不友好，HTML 完美折叠）
- 分歧矩阵：表格高亮 columns
- 仅 127.0.0.1 绑定（不暴露 LAN）；端口默认 7421，可在 `prefs.ui.web_port` 改
- run 完成后 server 保持运行，按 Ctrl+C 关闭并退出

## 追问（Follow-up）

run 收敛后，可基于该 run 的结论继续提问。每次追问产生一个独立 run，meta 含 `parent_run_id` 指向被追问的 run，形成 thread 链。

### Web view 入口

打开浏览器看到 final 后，下方的"追问"输入框输入问题点提交：

- 上文自动折叠为 `<details>`，进度区切到新 run
- agent 看到从 root 一路下来所有祖先的 `(enhanced_question, final.md)`
- 不刷页，浏览器历史栈保持干净

### CLI 入口

```bash
# 接受短前缀（与 rtai show / resume 一致）
rtai followup abc12 "保养上有什么坑？"

# 链式追问
rtai followup <follow-up_id> "如果预算只剩 1000 呢？"
```

### 限制

- 仅 `converged` / `escaped` / `single_agent_completed` 状态的 run 可被追问
- `--no-persist` 与 `followup` 互斥（追问 run 必须落盘以便能被后续引用）
- 长链 token 由 adapter 自身上限决定；超长链建议另起一个 thread

## Pipe 友好

```bash
# 重定向 stdout，仅拿 final.md（无进度行混入）
rtai --no-tui "..." > out.md

# 结合 jq / awk 处理（虽然 final.md 是 markdown，但这是 Linux 的方式）
rtai --no-tui "..." | head -100
```

## 持久化 / 历史

```bash
# 列表（按时间倒序）
rtai history

# 过滤
rtai history --scene=consumer
rtai history --lang=zh-Hans

# 详情
rtai show <uuid>
rtai show <uuid> --rounds        # 含每轮每个 agent 的 raw JSON

# 中断后继续
rtai resume <uuid>

# 导出
rtai export <uuid> --format=md > saved.md

# 删除
rtai history forget <uuid>
rtai history clear                # 删全部
```

## 配置管理

```bash
# Models
rtai config models list
rtai config models enable claude
rtai config models disable gemini
rtai config models effort codex high      # 5 级：none / low / medium / high / max
rtai config models version claude claude-opus-4-7
rtai config models auth claude            # 只显示 login 指引；不存凭据

# Scenes
rtai config scenes list
rtai config scenes show consumer

# Roles
rtai config roles enhancer claude
rtai config roles executor rotate         # 或 random / 或具体 model 名

# Language
rtai config language show
rtai config language list                 # 10 内置翻译包 + alias 表
rtai config language set zh-Hans
rtai config language set 简中             # alias normalize → zh-Hans
rtai config language set-ui en
rtai config language set-fallback en
rtai config language reset

# Alias（rtai / rt 命令名管理）
rtai config alias check                   # 诊断当前 alias 是否仍指向我们
rtai config alias unset-short             # 移除 rt 短别名
rtai config alias unset-primary           # 恢复 rtai native 主名

# 重跑 wizard
rtai setup
```

## Prefs 文件

`~/.config/roundtable.ai/prefs.yaml`：

```yaml
defaults:
  max_rounds: 4
  min_rounds: 2
  max_total_seconds: 600
  abort_on_exceed: false

ui:
  tui: on              # on / off
  web_view: on         # off / print_url_only / on
  web_port: 7421
  verbosity: normal    # quiet / normal / verbose

language:
  output: auto         # auto / system / BCP-47
  ui: system           # system / match_output / BCP-47
  fallback: en
  community_pack_notice: on

editor:
  command: $EDITOR

history:
  retain_runs: unlimited   # unlimited / last_100 / ttl_30days
  redact_patterns: []      # 正则数组，落盘前替换为 [REDACTED]

security:
  adapters_mjs_trusted_mtime: null

upgrade:
  check: on              # off 关闭 npm registry 启动检查

auth_recovery_policy: skip   # skip / abort（非交互环境的 auth 失效策略）

cli:
  primary_name: rtai
  primary_status: native
  short_alias: rt
  short_alias_status: native
```

## 三种路径速查

| `enabled_models.length` | `participants.length`（Layer 2 三重交集后） | 路径 |
|---|---|---|
| 0 | — | abort 报错 |
| 1 | — | **单 agent direct**：跳过 Enhancer + 强制 general scene |
| ≥ 2 | ≥ 2 | **多 agent 圆桌**：标准 round loop |
| ≥ 2 | 1 | **单 agent downgraded**：保留 Enhancer 上下文 |
| ≥ 2 | 0 | fallback general scene 重算；二次仍 0 → abort |

## Web view

启用 `prefs.ui.web_view`：

- `off`：完全不启动 server
- `print_url_only`：启动 + 显示 URL（TUI on → 顶部状态栏；TUI off → stderr）
- `on`（默认）：启动 + 自动打开浏览器

页面展示比 TUI 更详细：每 agent 每 round 卡片、peer_review 矩阵、分歧 timeline。

## 故障排查

```bash
# 检查 model 可用性
rtai config models check claude          # 跑 binaryAvailable + detectAuthState

# 看上次 run 的事件序列
rtai show <uuid> --rounds | less

# 强制重跑 setup
rtai setup
```
