# 自加 Adapter — Roundtable.ai

如果你想接入除 Claude / Codex / Gemini 之外的 model（如 Kimi / Grok / DeepSeek / 自己跑的本地模型 CLI），有两种方式：

## 方式 1：YAML adapter（推荐）

在 `~/.config/roundtable.ai/models.yaml` 中加条目即可，**无需写代码**：

```yaml
models:
  kimi:
    enabled: true
    type: cli
    command: ["kimi-cli", "ask"]      # 实际 CLI 命令
    timeout_s: 300
    capabilities:
      - web_search
      - reasoning_effort
    role_suitability:
      enhancer: high
      executor: high
    effort_mapping:
      none: []
      low: ["--reasoning", "low"]
      medium: ["--reasoning", "medium"]
      high: ["--reasoning", "high"]
      max: ["--reasoning", "max"]
    auth:
      check_command: "kimi-cli auth check"
      auth_command_hint: "在另一个终端运行：kimi-cli login"
      stderr_expired_patterns:
        - "401"
        - "unauthorized"
        - "expired"
    prompt_transport: stdin             # stdin / tmpfile / argv（默认 stdin）
    output:
      mode: json_extract                # stream_json / json_extract / pure_json / code_fence
      json_regex: "(\\{.*\\})"
    usage:
      mode: json_path
      json_path: "usage"
```

之后：

```bash
rtai config models enable kimi
rtai config scenes show coding          # 看 kimi 是否在偏好 scene
# 或者编辑 scenes.yaml 把 kimi 加入到某些 scene.models
```

### YAML 字段约定

| 字段 | 必填 | 说明 |
|---|---|---|
| `enabled` | ✓ | 是否启用本 model |
| `type` | ✓（自加 adapter） | 目前仅 `cli` |
| `command` | ✓（自加） | spawn 用 argv 数组；不含 prompt（prompt 走 stdin） |
| `capabilities[]` | ✓ | 用于 scene 三重交集过滤；常用值：`web_search` / `code_understanding` / `code_execution` / `reasoning_effort` |
| `role_suitability` | ✓ | wizard 排序 hint；`high` / `medium` / `low` |
| `effort_mapping` | ✓ | 5 级 → CLI flag 数组；未声明的 level 会 fallback 到最接近的 + warn |
| `auth.check_command` | ⚠ | 至少有 `check_command` 或 `check_env` 之一 |
| `auth.check_env` | ⚠ | 同上；env fast path |
| `auth.auth_command_hint` | ✓ | 用户面向 re-auth 文案 |
| `auth.stderr_expired_patterns[]` | — | 被动识别 auth 过期的正则 |
| `prompt_transport` | — | `stdin`（默认 / 推荐）/ `tmpfile` / `argv`（>4KB 拒绝） |
| `output.mode` | ✓ | `stream_json`（NDJSON）/ `json_extract`（regex）/ `pure_json` / `code_fence` |
| `output.json_regex` | ⚠ | `output.mode=json_extract` 时必填 |
| `usage.mode` | — | `stream_json` / `regex` / `json_path` / `none` |
| `version` | — | 选择具体 model 版本（如 `kimi-k1-8k`） |
| `cli_path` | — | binary 绝对路径 override（缺省时从 $PATH 解析） |
| `timeout_s` | — | per-agent timeout 秒数（默认 300） |

### prompt_transport 三档

| Mode | 安全性 | 兼容性 | 推荐场景 |
|---|---|---|---|
| `stdin`（默认） | ✓ 不暴露给 `ps` | 大多数 CLI 支持 | 首选 |
| `tmpfile` | ✓ 0600 临时文件 + try/finally unlink | CLI 仅支持 `--prompt-file=<path>` | argv 中含 `{prompt_file}` 占位符会被替换为实际路径 |
| `argv` | ✗ 暴露给 `ps` | 备用 | 仅在 CLI 不支持 stdin / tmpfile；prompt > 4KB MUST 拒绝 |

## 方式 2：JS adapter（power user）

在 `~/.config/roundtable.ai/adapters.mjs` 写 ESM 代码导出 Adapter 实例：

```javascript
// ~/.config/roundtable.ai/adapters.mjs

class MyCustomAdapter {
  name = 'my-custom';
  capabilities = ['reasoning_effort'];
  roleSuitability = { enhancer: 'medium', executor: 'high' };

  async binaryAvailable() {
    // 不触发 auth；仅查 binary 是否存在
    return true; // 比如 native HTTP API 不需要 binary
  }

  async version() {
    return '1.0.0';
  }

  async detectAuthState() {
    // ok / missing / expired / unknown
    return 'ok';
  }

  authInstructions() {
    return 'set MY_CUSTOM_API_KEY env var';
  }

  async invoke({ prompt, schema, effort, timeoutMs }) {
    // 你的实际调用逻辑：HTTP / subprocess / 其他 SDK
    const response = await fetch('https://my.api/v1/chat', {
      headers: { 'Authorization': `Bearer ${process.env.MY_CUSTOM_API_KEY}` },
      body: JSON.stringify({ prompt, effort }),
    });
    const data = await response.json();
    const parsed = schema.parse(JSON.parse(data.content));
    return {
      rawStdout: data.content,
      parsed,
      usage: {
        input_tokens: data.usage.prompt_tokens,
        output_tokens: data.usage.completion_tokens,
      },
      durationMs: data.duration_ms,
    };
  }
}

export default new MyCustomAdapter();          // 或导出 Adapter[] 数组
```

### JS adapter 注意事项

- **TypeScript 源文件不支持**：v1 不内置 `tsx` runtime；想写 TS 请自己 `tsc` / `tsup` 编译为 `.mjs` 后放入
- **信任模型**：首次加载 + 文件 mtime 变化都需要你显式确认（避免恶意 `adapters.mjs` 静默执行）
- **权限校验**：文件权限 group/other 任一位可写 → 拒绝加载（`chmod 600 ~/.config/roundtable.ai/adapters.mjs`）
- **`--no-adapters-mjs` flag**：CI / 不信任环境下跳过加载
- **同名冲突**：与 YAML adapter / 内置 adapter 同名 → YAML 优先 + warn；建议用独特名

## 测试你的 adapter

```bash
rtai config models check my-custom    # 跑 binaryAvailable + detectAuthState
rtai config models enable my-custom
rtai --enhancer=my-custom "test question"   # 把它当 enhancer 测一遍
```

## 完整接口参考

```typescript
interface Adapter {
  readonly name: string;
  readonly capabilities: readonly string[];
  readonly roleSuitability: {
    enhancer: 'high' | 'medium' | 'low';
    executor: 'high' | 'medium' | 'low';
  };
  binaryAvailable(): Promise<boolean>;
  version(): Promise<string>;
  detectAuthState(): Promise<'ok' | 'missing' | 'expired' | 'unknown'>;
  authInstructions(): string;
  invoke(args: {
    prompt: string;
    schema: unknown; // Zod schema
    effort: 'none' | 'low' | 'medium' | 'high' | 'max';
    timeoutMs: number;
  }): Promise<{
    rawStdout: string;
    parsed: unknown;
    usage: Usage | null;
    durationMs: number;
  }>;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens?: number;
  reasoning_tokens?: number;
  provisional?: boolean;  // 流式 usage 增量包时设 true，TUI 加 ~ 前缀
}
```

## 排错

- **schema 校验失败**：检查 `output.mode` + `output.json_regex`；用 `--verbose` 看 raw stdout
- **timeout**：调高 `models.<name>.timeout_s`
- **auth 检测错**：双轨 CLI（如同时支持 API key 与 OAuth login）应当**先**配 `check_command`（权威）+ 可选 `check_env`（fast path）
- **CLI 升级后 effort_mapping 失效**：直接改 `models.yaml.<name>.effort_mapping`；CLI flag 不是长期契约
