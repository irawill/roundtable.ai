# Translation Pack Contributions — Roundtable.ai

v1 ships with 10 built-in translation packs; everything except `en` / `zh-Hans` is marked `community` (community baseline), and revisions are welcome.

## The 10 Built-in Packs

| BCP-47 | Name | Quality | Primary Owner |
|---|---|---|---|
| `en` | English | verified | Project maintainers |
| `zh-Hans` | 简体中文 | verified | Project maintainers |
| `zh-Hant` | 繁體中文 | community | Native speaker wanted |
| `ja` | 日本語 | community | Native speaker wanted |
| `ko` | 한국어 | community | Native speaker wanted |
| `es` | Español | community | Native speaker wanted |
| `fr` | Français | community | Native speaker wanted |
| `de` | Deutsch | community | Native speaker wanted |
| `pt-BR` | Português (Brasil) | community | Native speaker wanted |
| `ru` | Русский | community | Native speaker wanted |

## Translation Pack Format

Each language pack is a single JSON file located at `src/i18n/<tag>.json`.

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

### Field Conventions

- **`$meta`**: pack metadata; `quality` is either `verified` or `community`
- **`<key>`**: flat string keys (dot-separated namespaces, e.g. `finalizer.section.consensus`)
- **`{placeholder}`**: interpolation placeholder, replaced at runtime with the actual value (e.g. `{agent}` → `claude`)
- **Keep in English**: technical terms / well-known proper nouns / error codes / version numbers stay in English (e.g. `Run ID`, `React`, `BCP-47`)

### Missing-Key Behavior

- A key missing from a translation pack → automatically falls back to the same key in `en`
- The entire translation pack is not built in (e.g. user passes `--lang=vi`) → falls back to `prefs.yaml.language.fallback` (defaults to `en`) and emits a warning

## Contribution Workflow

### Revising an Existing community Pack

```bash
# 1. Fork the repo
# 2. Edit src/i18n/<tag>.json and correct any inaccurate fields
# 3. Run the tests
npm test

# 4. Open a PR, and in the template include:
#    - Whether you are a native speaker / fluent / learner of the language
#    - Which keys you changed and why
#    - Whether you referenced localizations from comparable projects (e.g. VS Code, GitHub UI)
```

### Promoting community → verified

Promoting a community pack to verified requires:

1. **At least 2 native speakers** have each reviewed the pack
2. **The CHANGELOG explicitly lists** the rationale for promotion plus the reviewers
3. **Approval from a project maintainer**

Subsequent changes to a verified pack also require native-speaker review.

### Adding a New Translation Pack (Languages Beyond the 10 v1 Built-ins)

The 10 built-in languages for v1 are locked; new languages (e.g. `vi` / `id` / `hi` / `tr` / `ar`) will be added in later minor releases. If you want to push one forward:

1. Open an RFC issue on GitHub describing: user base, whether it is RTL (`ar` / `he` / `fa` are gated behind their own milestone)
2. Once a maintainer approves the RFC, open a PR that:
   - Adds `src/i18n/<tag>.json` (a complete translation of every key)
   - Updates `src/shared/lang/packs.ts` to register the new pack
   - Updates `src/shared/lang/alias.ts` with common aliases
   - Updates the README and this document

## RTL Languages (v2+ Scope)

RTL languages (`ar` / `he` / `fa`) require dedicated bidirectional-text engineering work in the ink TUI; v1 does **not** support them, and they will land as a separate milestone in v2. If you would like to lead this effort, please start the discussion in an issue.

## Content That Is Not Translated (Enforced at Runtime)

The Orchestrator's prompts explicitly instruct agents to **leave the following untranslated**:

- Code blocks / commands / shell snippets
- Code identifiers (function / variable / class names) / API names / library names / file paths / URLs
- Error codes / version numbers
- Well-known proper nouns (React / TypeScript / Kubernetes / CSV / JSON / GraphQL, etc.)

Translation packs should follow the same convention — do not, for example, translate `Run ID` into a localized term.

## Error Logs Are Always in English

Stack traces and error logs on `stderr` are **always in English** (developer-facing) and are **not** subject to i18n. This is intentional — localizing error messages would make debugging harder for maintainers.
