# Custom Adapters — Roundtable.ai

If you want to plug in a model other than Claude / Codex / Gemini (e.g. Kimi / Grok / DeepSeek / your own local-model CLI), there are two ways:

## Option 1: YAML adapter (recommended)

Add an entry to `~/.config/roundtable.ai/models.yaml` — **no code required**:

```yaml
models:
  kimi:
    enabled: true
    type: cli
    command: ["kimi-cli", "ask"]      # the actual CLI command
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
      auth_command_hint: "Run in another terminal: kimi-cli login"
      stderr_expired_patterns:
        - "401"
        - "unauthorized"
        - "expired"
    prompt_transport: stdin             # stdin / tmpfile / argv (default: stdin)
    output:
      mode: json_extract                # stream_json / json_extract / pure_json / code_fence
      json_regex: "(\\{.*\\})"
    usage:
      mode: json_path
      json_path: "usage"
```

Then:

```bash
rtai config models enable kimi
rtai config scenes show coding          # check whether kimi is in the preferred scene
# Or edit scenes.yaml to add kimi to some scene.models
```

### YAML field reference

| Field | Required | Description |
|---|---|---|
| `enabled` | ✓ | Whether this model is enabled |
| `type` | ✓ (custom adapter) | Currently only `cli` |
| `command` | ✓ (custom) | argv array for spawn; does not include the prompt (prompt goes through stdin) |
| `capabilities[]` | ✓ | Used by the scene triple-intersection filter; common values: `web_search` / `code_understanding` / `code_execution` / `reasoning_effort` |
| `role_suitability` | ✓ | Wizard-ordering hint; `high` / `medium` / `low` |
| `effort_mapping` | ✓ | 5 levels → CLI flag array; undeclared levels fall back to the closest one with a warning |
| `auth.check_command` | ⚠ | At least one of `check_command` or `check_env` is required |
| `auth.check_env` | ⚠ | Same as above; env fast path |
| `auth.auth_command_hint` | ✓ | User-facing re-auth message |
| `auth.stderr_expired_patterns[]` | — | Regexes for passively detecting expired auth |
| `prompt_transport` | — | `stdin` (default / recommended) / `tmpfile` / `argv` (rejected for payloads >4KB) |
| `output.mode` | ✓ | `stream_json` (NDJSON) / `json_extract` (regex) / `pure_json` / `code_fence` |
| `output.json_regex` | ⚠ | Required when `output.mode=json_extract` |
| `usage.mode` | — | `stream_json` / `regex` / `json_path` / `none` |
| `version` | — | Pin a specific model version (e.g. `kimi-k1-8k`) |
| `cli_path` | — | Absolute path override for the binary (defaults to `$PATH` resolution) |
| `timeout_s` | — | Per-agent timeout in seconds (default 300) |

### prompt_transport modes

| Mode | Safety | Compatibility | Recommended use |
|---|---|---|---|
| `stdin` (default) | ✓ Not exposed to `ps` | Supported by most CLIs | First choice |
| `tmpfile` | ✓ 0600 temp file with try/finally unlink | CLIs that only support `--prompt-file=<path>` | A `{prompt_file}` placeholder in argv is replaced with the actual path |
| `argv` | ✗ Exposed to `ps` | Fallback | Only when the CLI supports neither stdin nor tmpfile; prompts > 4KB MUST be rejected |

## Option 2: JS adapter (power user)

Write ESM code in `~/.config/roundtable.ai/adapters.mjs` that exports an Adapter instance:

```javascript
// ~/.config/roundtable.ai/adapters.mjs

class MyCustomAdapter {
  name = 'my-custom';
  capabilities = ['reasoning_effort'];
  roleSuitability = { enhancer: 'medium', executor: 'high' };

  async binaryAvailable() {
    // Does not trigger auth; only checks whether the binary exists
    return true; // e.g. a native HTTP API needs no binary
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
    // Your actual call logic: HTTP / subprocess / another SDK
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

export default new MyCustomAdapter();          // or export an Adapter[] array
```

### JS adapter notes

- **TypeScript source files are not supported**: v1 does not bundle a `tsx` runtime; if you want to write TS, compile it to `.mjs` yourself with `tsc` / `tsup` first
- **Trust model**: both the first load and any change to the file's mtime require explicit confirmation from you (prevents a malicious `adapters.mjs` from running silently)
- **Permission check**: any group/other write bit on the file causes loading to be rejected (`chmod 600 ~/.config/roundtable.ai/adapters.mjs`)
- **`--no-adapters-mjs` flag**: skips loading in CI / untrusted environments
- **Name collisions**: if your name clashes with a YAML adapter or a built-in adapter, YAML wins and a warning is emitted; pick a unique name

## Testing your adapter

```bash
rtai config models check my-custom    # runs binaryAvailable + detectAuthState
rtai config models enable my-custom
rtai --enhancer=my-custom "test question"   # exercise it as an enhancer once
```

## Full interface reference

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
  provisional?: boolean;  // set to true for streaming usage-delta packets; TUI prepends a ~
}
```

## Troubleshooting

- **Schema validation failure**: check `output.mode` + `output.json_regex`; use `--verbose` to inspect the raw stdout
- **Timeout**: raise `models.<name>.timeout_s`
- **Wrong auth detection**: for dual-track CLIs (e.g. ones that support both an API key and OAuth login), configure `check_command` (authoritative) **first**, with an optional `check_env` (fast path)
- **`effort_mapping` broken after a CLI upgrade**: just edit `models.yaml.<name>.effort_mapping`; CLI flags are not a long-term contract
</content>
</invoke>