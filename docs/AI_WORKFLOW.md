# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It also cancels superseded in-progress runs for the same ref, which avoids burning Actions minutes on stale commits.

- ESLint (including accessibility, hardcoded-color, and IDOR custom rules)
- `tsc --noEmit` type check
- Full Vitest suite (`npm run test:run`)

**Why tests don't need to run locally before commits:** CI is the authoritative quality gate. The pre-commit hook runs only `lint-staged` (ESLint fix + Prettier on staged files). Running the full test suite in the hook added ~20s to every commit and produced no signal that CI didn't already catch. If CI fails, the PR is blocked.

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
kimi-review --scope "carousel timezone header threading" --base main
```

**Filter pattern:**

```bash
kimi-review --scope "..." --base main | grep -A2 'CRITICAL\|WARNING' || true
```

The `grep -A2` prints the matched line plus 2 lines of context (the finding body). The SUGGESTION tier is excluded because suggestion-level findings are style preferences — surfacing them into Claude's context triggers unnecessary rewrites and burns tokens without improving correctness or safety. CRITICAL and WARNING are actionable; SUGGESTION is not.

**Rule:** If `kimi-review` returns a CRITICAL finding, stop and surface it to the user before committing.

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
