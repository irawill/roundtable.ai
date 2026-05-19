# Usage — Roundtable.ai

Complete user manual. This document assumes you have already completed `rtai setup` once and enabled at least 1 model.

## Basic usage

```bash
rtai "你的问题"
```

- **In v0.1.0, progress goes to stderr** (regardless of how `prefs.ui.tui` is configured): Enhancer work / scene detection / user confirmation / round start-end / per-agent completion all emit a short status line. The real ink-based interactive TUI (agent status cards / token ticker) is deferred to v0.2.0.
- After a run completes, **stdout emits final.md in one shot** (pipe-friendly); progress lines always go to stderr and will not mix with final.
- All runs are persisted to `~/.local/share/roundtable.ai/runs/<uuid>/` (unless `--no-persist`).
- **Expected duration**: scenes like consumer / research / decision with 3-5 rounds and 3 agents typically take 5-15 minutes; if a progress line appears stuck, it is likely that a single agent is performing `web_search` — this is normal.

## Common scene examples

### consumer (purchase decisions)

```bash
rtai "推荐一款 3000 元档的扫地机器人"
```

The wizard recognizes this via the `consumer` scene (confidence ≥ 0.8) → 3 agents use `web_search` to find currently in-sale models → 3-5 rounds of cross-review → produces a comparison table + recommendation.

### coding (programming)

```bash
rtai "React 的 useEffect 怎么写 cleanup？"
```

`coding` scene: only claude + codex participate; strict convergence tier; 2-3 rounds; output contains code blocks.

### decision (strategic choice)

```bash
rtai "我们应该用 monorepo 还是 multirepo？团队 8 人，3 个独立产品。"
```

`decision` scene: loose convergence tier (allows reasoning divergence); 4-6 rounds; output contains pros/cons.

### research (in-depth research)

```bash
rtai "总结一下 2025 年下半年 AI Agent 框架的主要 camp"
```

`research` scene: 3 agents use `web_search`; output contains citation sources.

## Key flags

| Flag | Purpose |
|---|---|
| `--scene=<name>` | Force the scene; still runs Enhancer for completion + clarifying questions + language detection |
| `--lang=<tag>` | Output language; accepts `auto` / `system` / BCP-47 / alias (e.g., `简中`) |
| `--ui-lang=<tag>` | UI language; accepts `system` / `match_output` / BCP-47 |
| `--effort=<spec>` | Single value `high` or per-model `claude:max,codex:high` |
| `--enhancer=<model>` | Temporarily swap the enhancer |
| `--executor=<spec>` | Temporarily swap the executor (`<model>` / `rotate` / `random`) |
| `--no-tui` | Disable TUI; intermediate progress goes to stderr; suitable for `rtai "..." > out.md` |
| `--no-persist` | Do not persist the entire run; `rtai resume` becomes unavailable |
| `--no-adapters-mjs` | Skip loading `~/.config/roundtable.ai/adapters.mjs` |
| `--verbose` / `--quiet` | TUI / stderr verbosity (stdout always emits only final.md) |
| `--web-view=<mode>` | HTML preview: `off` (stderr progress only) / `print_url_only` (start server, print URL) / `on` (default, start + auto-open browser); overrides `prefs.ui.web_view` |

## Web view (HTML preview)

```bash
# Start and auto-open browser (recommended — final.md is long markdown and hard to read in a terminal; HTML offers collapsible sections + a disagreement matrix card with much higher readability)
rtai --web-view=on "推荐一款扫地机器人"

# Start + print URL only (remote SSH / open the browser manually)
rtai --web-view=print_url_only "..."

# Disable permanently (edit prefs.yaml; default is on):
#   ui:
#     web_view: off
#   Or explicitly print URL only:
#     web_view: print_url_only
```

Features:
- Live progress: Enhancer status / user confirmation / each round each agent thinking → done / final
- `<details>` collapsing: the "full answer from each model" section is collapsed by default (flattened layout is unfriendly in the terminal, but HTML handles it perfectly)
- Disagreement matrix: table with highlighted columns
- Binds only to 127.0.0.1 (not exposed on the LAN); port defaults to 7421, configurable via `prefs.ui.web_port`
- After the run completes, the server keeps running; press Ctrl+C to shut it down and exit

## Follow-up

After a run converges, you can continue asking questions based on its conclusion. Each follow-up produces an independent run whose meta contains `parent_run_id` pointing to the followed-up run, forming a thread chain.

### Web view entry point

After the final appears in the browser, type your follow-up question into the "Follow-up" input box below and submit it:

- The preceding context is automatically collapsed into `<details>`; the progress section switches to the new run.
- The agent sees `(enhanced_question, final.md)` from every ancestor along the path from the root.
- The page is not reloaded; browser history stays clean.

### CLI entry point

```bash
# Accepts short prefixes (consistent with rtai show / resume)
rtai followup abc12 "保养上有什么坑？"

# Chained follow-ups
rtai followup <follow-up_id> "如果预算只剩 1000 呢？"
```

### Limitations

- Only runs in `converged` / `escaped` / `single_agent_completed` state can be followed up.
- `--no-persist` and `followup` are mutually exclusive (a follow-up run must be persisted so it can be referenced later).
- The token budget for long chains is determined by the adapter's own limit; for very long chains, start a new thread.

## Pipe friendly

```bash
# Redirect stdout to capture only final.md (no progress lines mixed in)
rtai --no-tui "..." > out.md

# Combine with jq / awk (final.md is markdown, but this is the Linux way)
rtai --no-tui "..." | head -100
```

## Persistence / history

```bash
# List (reverse chronological order)
rtai history

# Filter
rtai history --scene=consumer
rtai history --lang=zh-Hans

# Details
rtai show <uuid>
rtai show <uuid> --rounds        # Includes the raw JSON of each agent per round

# Resume after interruption
rtai resume <uuid>

# Export
rtai export <uuid> --format=md > saved.md

# Delete
rtai history forget <uuid>
rtai history clear                # Delete everything
```

## Configuration management

```bash
# Models
rtai config models list
rtai config models enable claude
rtai config models disable gemini
rtai config models effort codex high      # 5 levels: none / low / medium / high / max
rtai config models version claude claude-opus-4-7
rtai config models auth claude            # Only shows login instructions; does not store credentials

# Scenes
rtai config scenes list
rtai config scenes show consumer

# Roles
rtai config roles enhancer claude
rtai config roles executor rotate         # Or random / or a specific model name

# Language
rtai config language show
rtai config language list                 # 10 built-in translation packs + alias table
rtai config language set zh-Hans
rtai config language set 简中             # alias normalize → zh-Hans
rtai config language set-ui en
rtai config language set-fallback en
rtai config language reset

# Alias (rtai / rt command name management)
rtai config alias check                   # Diagnose whether the current alias still points to us
rtai config alias unset-short             # Remove the rt short alias
rtai config alias unset-primary           # Restore the rtai native primary name

# Rerun the wizard
rtai setup
```

## Prefs file

`~/.config/roundtable.ai/prefs.yaml`:

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
  redact_patterns: []      # Array of regexes; matches are replaced with [REDACTED] before persistence

security:
  adapters_mjs_trusted_mtime: null

upgrade:
  check: on              # off disables the npm registry check at startup

auth_recovery_policy: skip   # skip / abort (auth-failure policy in non-interactive environments)

cli:
  primary_name: rtai
  primary_status: native
  short_alias: rt
  short_alias_status: native
```

## Three-path quick reference

| `enabled_models.length` | `participants.length` (after Layer 2 triple intersection) | Path |
|---|---|---|
| 0 | — | abort with error |
| 1 | — | **single-agent direct**: skip Enhancer + force general scene |
| ≥ 2 | ≥ 2 | **multi-agent roundtable**: standard round loop |
| ≥ 2 | 1 | **single-agent downgraded**: preserve Enhancer context |
| ≥ 2 | 0 | recompute with fallback general scene; if still 0 on the second pass → abort |

## Web view

Enable via `prefs.ui.web_view`:

- `off`: do not start the server at all
- `print_url_only`: start + display URL (TUI on → top status bar; TUI off → stderr)
- `on` (default): start + automatically open browser

The page is more detailed than the TUI: per-agent per-round cards, peer_review matrix, disagreement timeline.

## Troubleshooting

```bash
# Check model availability
rtai config models check claude          # Runs binaryAvailable + detectAuthState

# Inspect the event sequence of the last run
rtai show <uuid> --rounds | less

# Force-rerun setup
rtai setup
```
