**English** | [简体中文](./README.md)

<p align="center">
  <img src="./assets/RoundTable.png" alt="Roundtable.ai" width="200" />
</p>

<h1 align="center">Roundtable.ai</h1>

<p align="center">
  <em>Bring multiple frontier AI CLIs to one table: parallel answers → multi-round cross-review → consensus or honest disagreement.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@roundtablelabs/cli"><img src="https://img.shields.io/npm/v/@roundtablelabs/cli.svg?color=cb3837&label=npm" alt="npm version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/@roundtablelabs/cli.svg?color=blue" alt="license" /></a>
  <a href="https://github.com/irawill/roundtable.ai/stargazers"><img src="https://img.shields.io/github/stars/irawill/roundtable.ai?style=social" alt="GitHub stars" /></a>
  <a href="https://github.com/irawill/roundtable.ai/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/irawill/roundtable.ai/ci.yml?branch=main&label=CI" alt="CI" /></a>
</p>

> Like the idea? Please [give it a ⭐ on GitHub](https://github.com/irawill/roundtable.ai) — it helps others discover it.

**v0.1.0 is live**: install via `npm install -g @roundtablelabs/cli` or try without install via `npx @roundtablelabs/cli "your question"`. See the [npm page](https://www.npmjs.com/package/@roundtablelabs/cli).

## What is it

Roundtable.ai automates the workflow you already do by hand — asking ChatGPT, Claude, and Gemini the same question and merging the answers in your head — into a single command:

```bash
rtai "Recommend a robot vacuum around $400"
```

→ calls Claude Code / Codex / Gemini CLI in parallel → Enhancer auto-detects the scene and fills in gaps → multi-round cross-review → returns a final answer with **multi-model consensus or honest disagreement**.

## Install

```bash
# Try it with zero install via npx (recommended)
npx @roundtablelabs/cli "your question"

# Or install globally
npm install -g @roundtablelabs/cli
rtai "your question"
```

**Prerequisites**:

- Node.js >= 22 LTS
- At least one of the following CLIs installed and logged in:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
  - [Codex CLI](https://github.com/openai/codex)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)

Roundtable.ai does not manage auth for these CLIs — it only detects them and points you to the right terminal to `login`.

## Quick start

The first run drops you into the setup wizard:

```bash
rtai "your question"
# The wizard will:
# 1. Scan $PATH for installed claude / codex / gemini
# 2. Ask which models to enable (at least 1)
# 3. Pick enhancer / executor roles
# 4. Pick output language (defaults to $LANG)
# 5. Optionally add a short rt alias for rtai
# Then it continues with your original question
```

## Scene system

Roundtable.ai auto-selects one of 7 built-in scenes based on the question type (or set one with `--scene=xxx`):

| Scene | Purpose | Preferred models | Min/max rounds |
|---|---|---|---|
| `general` | Catch-all questions (default fallback) | claude / codex / gemini | 2–4 |
| `consumer` | Product recommendations and comparisons | claude / codex / gemini (needs web_search) | 3–5 |
| `coding` | Programming, debugging, architecture | claude / codex (needs code_understanding) | 2–3 |
| `research` | Deep research and literature reviews | claude / gemini / codex (needs web_search) | 3–5 |
| `decision` | Decision support and trade-off analysis | claude / codex / gemini | 4–6 |
| `creative` | Creative writing and copywriting | claude / codex / gemini | 2–3 |
| `reasoning` | Logic, math, and causal reasoning | claude / codex / gemini | 3–5 |

## Common commands

```bash
# Main flow
rtai "your question"                   # default: auto scene
rtai --scene=coding "..."              # force scene
rtai --lang=zh-Hans "..."              # force output language
rtai --no-tui "..."                    # disable TUI (pipe-friendly)
rtai --no-persist "sensitive question" # do not write to disk
rtai --web-view on "..."               # HTML preview (auto-opens browser); off / print_url_only / on

# History
rtai history                           # list (thread column shows: ↳ <parent> d=<depth>)
rtai history --scene=consumer
rtai history --lang=zh-Hans
rtai show <uuid>                       # details
rtai show <uuid> --rounds              # include raw per-round, per-agent output
rtai export <uuid> --format=md         # export markdown
rtai history forget <uuid>             # delete a specific run
rtai history clear                     # delete all

# Follow-up (continue from the previous conclusion; equivalent to the "follow up" box in the Web view)
rtai followup <parent_uuid> "Any maintenance pitfalls?"
rtai followup abc12 "..."              # short prefix works

# Config
rtai config models list
rtai config models enable claude
rtai config models effort codex high
rtai config roles enhancer claude
rtai config language set zh-Hans
rtai config language list              # show the alias table

# Upgrade
rtai upgrade                           # npm install -g @roundtablelabs/cli@latest
```

## Config directory

```
~/.config/roundtable.ai/
  models.yaml       # which models are enabled / version / effort / user-added adapters
  scenes.yaml       # v1 built-in 7 scenes plus your custom ones
  roles.yaml        # enhancer / executor roles
  prefs.yaml        # max_rounds / TUI / language / history retain / etc.
  adapters.mjs      # optional: user-defined JS adapters

~/.local/share/roundtable.ai/runs/<uuid>/
  meta.json
  events.jsonl
  final.md
```

## Documentation

- [docs/usage.en.md](docs/usage.en.md) — full user manual
- [docs/adapter-authoring.en.md](docs/adapter-authoring.en.md) — write your own adapter (YAML / JS)
- [docs/i18n-contributing.en.md](docs/i18n-contributing.en.md) — contribute a translation pack

## Design principles

- **Local-first**: every run is stored on your machine, nothing is uploaded to the cloud
- **No auth on your behalf**: each CLI manages its own login; we only detect and guide
- **Deterministic convergence check**: no second LLM acting as Judge — the rules only inspect structured fields
- **Honest disagreement > forced synthesis**: when models do not converge, we output the consensus, the disagreement matrix, and each model's full answer
- **Zero credential storage**: API keys and tokens never enter our config files
- **Two-axis i18n**: output language and UI language are separate; 10 built-in translation packs

## Security / Privacy

- Prompts are passed via stdin / tmpfile, never via argv, so they don't leak through `ps`
- Config directory is 0700 / files are 0600
- `adapters.mjs` can run arbitrary code — first load requires explicit user trust plus an mtime check
- `--no-persist` skips disk writes for the entire run
- `prefs.history.redact_patterns` runs regex redaction on sensitive fields before they hit disk
- Zero telemetry (only an optional npm registry upgrade check)

## Support the project

Roundtable.ai is a personally-maintained open-source project, still in its early days. If it solved a problem for you — or you just find the idea interesting — any of the following helps a lot:

- ⭐ **Star the project** on [GitHub](https://github.com/irawill/roundtable.ai) — the most direct way to encourage the author and help others find it
- 🐛 **Report bugs or share ideas** by [opening an issue](https://github.com/irawill/roundtable.ai/issues) — even a one-line piece of feedback is genuinely useful
- 🛠️ **Contribute code** — from fixing a typo to adding a new model CLI; see [docs/i18n-contributing.en.md](docs/i18n-contributing.en.md) for translation packs and [docs/adapter-authoring.en.md](docs/adapter-authoring.en.md) for new adapters
- 💬 **Tell a friend** — share with a colleague, in your community, or on social media so the people who need it can find it

Every star and every piece of feedback helps this project go further. 🙏

## License

MIT
