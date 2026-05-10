# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It also cancels superseded in-progress runs for the same ref, which avoids burning Actions minutes on stale commits.

Documentation-only pushes to `main` (`*.md`, `docs/**`, `todos/**`) are ignored so they do not spend full lint/type/test minutes. Pull requests still run CI so required status checks are always reported.

- ESLint (including accessibility, hardcoded-color, and IDOR custom rules)
- `tsc --noEmit` type check
- Full Vitest suite (`npm run test:run`)

**Why tests don't need to run locally before commits:** CI is the authoritative quality gate. The pre-commit hook runs only `lint-staged` (ESLint fix + Prettier on staged files). Running the full test suite in the hook added ~20s to every commit and produced no signal that CI didn't already catch. If CI fails, the PR is blocked.

When CI fails, inspect only failed step logs:

```bash
npm run ci:failed-logs
# or for a specific run:
npm run ci:failed-logs -- <run-id>
```

Do not paste full workflow logs into Claude. Failed-step logs are the useful signal.

### Pre-commit Hook (Husky / lint-staged)

`.husky/pre-commit` runs `lint-staged` only. Staged `.ts`/`.tsx` files get ESLint auto-fix + Prettier. The hook does **not** run `tsc` or `npm test` — CI owns those.

### CLAUDE.md

`CLAUDE.md` is **gitignored intentionally**. It is an AI instruction file, not project source. Checking it in would expose internal agent directives, bloat the repo, and make it harder to evolve AI-specific guidance independently from the codebase.

---

## Cheap-Worker Delegation (kimi-\* Tools)

The following CLI scripts are available globally and should be used to offload work that doesn't require Claude's full reasoning capacity. Delegating reduces context usage and speeds up the session.

### `ask-kimi`

**When:** Reading 3+ files for analysis — pattern lookups, summarization, cross-file questions.

```bash
ask-kimi --paths docs/patterns/api.md server/routes/carousel.ts --question "Does this route follow the error-response pattern?"
```

### `kimi-write`

**When:** Generating boilerplate that closely matches an existing reference file (new route, new storage module, new hook).

```bash
kimi-write --reference server/routes/nutrition.ts --target server/routes/carousel.ts --description "GET /api/carousel"
```

### `kimi-review`

**When:** Before committing any significant implementation. Diffs only changed lines and returns findings at CRITICAL/WARNING/SUGGESTION tiers.

```bash
kimi-review --scope "carousel timezone header threading" --base main --tiers CRITICAL,WARNING --profile ocrecipes
```

**Filter pattern:**

```bash
kimi-review --scope "..." --base main --tiers CRITICAL,WARNING --profile ocrecipes
```

The `--tiers CRITICAL,WARNING` option tells Kimi to request and return only actionable findings. The SUGGESTION tier is excluded because suggestion-level findings are style preferences — surfacing them into Claude's context triggers unnecessary rewrites and burns tokens without improving correctness or safety. CRITICAL and WARNING are actionable; SUGGESTION is not.

The `--profile ocrecipes` option adds concise project-specific review priorities: Bearer JWT/IDOR checks, health-data boundaries, Express/Drizzle storage patterns, React Native/Expo constraints, TanStack Query/theme/navigation conventions, and AI/eval safety gates. Use it for this repo; omit it only when reviewing unrelated projects.

Use `--patterns` when a change needs review against specific repo conventions:

```bash
kimi-review --scope "new saved-items route" --base main --tiers CRITICAL,WARNING --profile ocrecipes --patterns security,api,database
```

`--patterns security,api` expands to `docs/patterns/security.md` and `docs/patterns/api.md`. Keep the list narrow so Kimi gets the relevant conventions without turning every review into a large context dump.

Pattern docs are capped at 12,000 characters each by default and include an explicit `[TRUNCATED]` marker when clipped. If a review truly needs the full file, pass `--pattern-max-chars 0`, but prefer a narrower pattern list first.

**Rule:** If `kimi-review` returns a CRITICAL finding, stop and surface it to the user before committing.

### `kimi-multi-review`

**When:** Escalated review for changes that cross multiple risky domains. It runs several domain-scoped `kimi-review` passes in parallel over one diff, each with targeted `--scope` and `--patterns` context.

```bash
kimi-multi-review --base main --scope "receipt review storage and UI changes"
```

By default `--reviewers auto` selects reviewers from changed paths. Available reviewers:

| Reviewer      | Use for                                                            | Pattern context                                 |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| `security`    | auth, IDOR, secrets, health-data boundaries, prompt injection      | `security,api,database`                         |
| `database`    | Drizzle, schema/storage contracts, transactions, ownership filters | `database,security,architecture`                |
| `rn`          | React Native screens/components/hooks/navigation                   | `react-native,client-state,design-system,hooks` |
| `ai`          | prompts, classifiers, eval datasets, cache-key isolation           | `ai-prompting,security,testing`                 |
| `testing`     | risky branches, changed contracts, fixture coverage                | `testing,typescript,architecture`               |
| `performance` | hot paths, cache behavior, renders, N+1 queries                    | `performance,react-native,database`             |

Use an explicit panel when needed:

```bash
kimi-multi-review --base main --reviewers security,database,testing --scope "new storage route"
```

Keep this as an escalation path. A single `kimi-review --tiers CRITICAL,WARNING --profile ocrecipes` remains the default for ordinary commits.

### `kimi-challenge`

**When:** Before choosing between two approaches or making an architectural decision (navigation patterns, camera flows, state management).

```bash
kimi-challenge --decision "use X-User-Hour header (integer) vs X-User-Timezone (IANA string) for carousel time-of-day"
```

Returns a structured for/against analysis. Claude makes the final call; kimi-challenge stress-tests the reasoning.

### `extract-chat`

**When:** Before passing a previous Claude Code session transcript back as context. It reads Claude Code JSONL logs and strips tool calls, thinking blocks, signatures, binary data, and framework-injected messages, leaving only conversation text.

```bash
extract-chat "$VSCODE_TARGET_SESSION_LOG" -o /tmp/session-chat.txt
```

This keeps historical session context lean before it re-enters Claude's context window. It does not process arbitrary `kimi-*` stdout.

---

## Token-Saving Conventions

| Convention                                                             | Reason                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Pattern lookups via `ask-kimi --paths docs/patterns/X.md`              | Avoids Claude re-reading pattern files each session                                  |
| `kimi-review` instead of code-reviewer subagent                        | Diffs changed lines only; subagent reads full files                                  |
| iOS/device setup in `docs/DEV_SETUP.md`                                | Keeps CLAUDE.md short; agents reference the doc, not inline instructions             |
| Repo architecture memory at `/memories/repo/ocrecipes-architecture.md` | Schema, nav, services, stack facts persist across sessions without re-reading source |

## Repo Memory Maintenance

Update `/memories/repo/ocrecipes-architecture.md` only when durable architecture facts change:

- New or removed major services, route groups, storage modules, or navigation roots
- New core database tables or renamed domain tables
- Changes to auth, state management, CI/test strategy, path aliases, or app stack
- Pattern-index changes that future agents should know before opening source files

Do **not** store transient TODOs, implementation notes, eval output, or details already isolated in a specific plan doc. Repo memory is loaded as compact context; keep it short and factual.
