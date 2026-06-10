# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

## Review Policy

Code review runs through the OCRecipes-pattern-aware **`code-reviewer` subagent** (Agent tool with `subagent_type: "code-reviewer"`). It reviews only the current context's changed files against established patterns (`.claude/agents/code-reviewer.md`) and is the canonical path wired into the `/todo` executor (Step 6) and the `/codify` self-improvement loop (Step 3). Escalate to specialist subagents (`security-auditor`, `database-specialist`, `performance-specialist`, etc.) for security, health-data, auth, or high-blast-radius changes.

The loop is **self-improving**: any review finding that reveals a reusable rule is fed back into `code-reviewer.md` and the matching specialist agent via `/codify` (`.claude/skills/codify/SKILL.md`), so the reviewer gets sharper over time. For a quick, generic, non-pattern-aware diff pass, the built-in `/code-review` skill is also available.

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It also cancels superseded in-progress runs for the same ref, which avoids burning Actions minutes on stale commits.

Documentation-only pushes to `main` (`*.md`, `docs/**`, `todos/**`) are ignored so they do not spend full lint/type/test minutes. Pull requests still run CI so required status checks are always reported.

- ESLint (including accessibility, hardcoded-color, and IDOR custom rules)
- `tsc --noEmit` type check
- Full Vitest suite (`npm run test:run`)

**Why tests don't need to run locally before commits:** CI is the authoritative quality gate. The pre-commit hook runs `lint-staged` on staged files. It does not run `tsc` or `npm test`. Running the full test suite in the hook added ~20s to every commit and produced no signal that CI didn't already catch. If CI fails, the PR is blocked.

When CI fails, inspect only failed step logs:

```bash
npm run ci:failed-logs
# or for a specific run:
npm run ci:failed-logs -- <run-id>
```

Do not paste full workflow logs into Claude. Failed-step logs are the useful signal.

### Pre-commit Hook (Husky / lint-staged)

`.husky/pre-commit` runs `lint-staged`. Staged `.ts`/`.tsx` files get ESLint auto-fix + Prettier.

The hook does **not** run `tsc` or `npm test` — CI owns those.

### CLAUDE.md

`CLAUDE.md` is **gitignored intentionally**. It is an AI instruction file, not project source. Checking it in would expose internal agent directives, bloat the repo, and make it harder to evolve AI-specific guidance independently from the codebase.

---

## Cheap-Worker Delegation (kimi-\* Tools and Copilot Issues)

The following CLI scripts are available globally and should be used to offload work that doesn't require the main agent's full reasoning capacity. Delegating reduces context usage and speeds up the session.

GitHub Copilot can also handle bounded repo-local tasks through GitHub Issues assigned to `@copilot`. Prefer the `kimi-*` tools below for cheap read/write/challenge passes; use Copilot Issues for tracked, tightly scoped deferred work where Copilot can open a normal pull request for human review.

### Copilot Issue Delegation

Use Copilot Issues for eligible low/deferred review items only. The local `todos/` file remains the audit/todo traceability record; the GitHub Issue is Copilot's work queue.

```bash
npm run copilot:delegate:dry-run -- todos/YYYY-MM-DD-slug.md
npm run copilot:delegate -- todos/YYYY-MM-DD-slug.md
```

The helper reads the todo, checks eligibility, and creates an issue with `gh issue create --assignee @copilot`. Dry-run mode prints the issue body without contacting GitHub. Live mode must fail loudly if issue creation or `@copilot` assignment fails.

Eligible items are scoped docs, tests, code-quality, simple performance, or simple refactor tasks with clear files and checkbox acceptance criteria. Do not delegate JWT/auth, IAP receipt validation, secrets, health-data boundaries, goal-safety behavior, schema/migrations, production data handling, or broad architecture changes without a human-approved plan.

Copilot output must be PR-based and human-reviewed. Never auto-merge Copilot work and never allow direct commits to `main`.

### `ask-kimi`

**When:** Reading 3+ files for analysis — pattern lookups, summarization, cross-file questions.

```bash
ask-kimi --paths docs/legacy-patterns/api.md server/routes/carousel.ts --question "Does this route follow the error-response pattern?"
```

### `kimi-write`

**When:** Generating boilerplate that closely matches an existing reference file (new route, new storage module, new hook).

```bash
kimi-write --reference server/routes/nutrition.ts --target server/routes/carousel.ts --description "GET /api/carousel"
```

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
| Pattern lookups via `ask-kimi --paths docs/legacy-patterns/X.md`       | Avoids Claude re-reading pattern files each session                                  |
| code-reviewer + specialist subagents for audits                        | Higher token cost, but better for deep cross-file reasoning and audit-style reviews  |
| iOS/device setup in `docs/DEV_SETUP.md`                                | Keeps CLAUDE.md short; agents reference the doc, not inline instructions             |
| Repo architecture memory at `/memories/repo/ocrecipes-architecture.md` | Schema, nav, services, stack facts persist across sessions without re-reading source |

## Repo Memory Maintenance

Update `/memories/repo/ocrecipes-architecture.md` only when durable architecture facts change:

- New or removed major services, route groups, storage modules, or navigation roots
- New core database tables or renamed domain tables
- Changes to auth, state management, CI/test strategy, path aliases, or app stack
- Pattern-index changes that future agents should know before opening source files

Do **not** store transient TODOs, implementation notes, eval output, or details already isolated in a specific plan doc. Repo memory is loaded as compact context; keep it short and factual.

## Drift Checklist

The canonical recurring drift list lives in `docs/AI_DRIFT_CHECKLIST.md`.

Use that file for anything you want to monitor via cron or another scheduled job. Keep IDs stable, update the status fields instead of renaming rows, and add new drift-prone items there rather than duplicating checklist logic in multiple docs.

The implementation plan for the scheduled checker that reads the checklist lives at [`docs/AI_DRIFT_AUTOMATION.md`](AI_DRIFT_AUTOMATION.md).
