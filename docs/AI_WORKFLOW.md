# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

## Review Policy

Code review is **orchestrator-dispatched, domain-selected, and scoped to the code in the current context** — the session's changed / working-tree files, never a repo-wide re-review. This section is the single source of truth; `/todo` (Step 6), `/audit` (Phases 3 + 6), `/codify` (Step 3), and on-demand reviews all follow it.

At review time the orchestrator (the `todo-executor` for `/todo`, the `/audit` skill for its review phases, or the main session for an on-demand review):

1. **Inspects the in-context diff** — both file **paths** and **content**.
2. **Selects the relevant reviewer subagents** from the roster below — typically **1–3, cap 4**. Path is a starting hint (the `docs/rules/<domain>` mapping); **content overrides it** — a JWT call → `security-auditor`, an `any` cast → `typescript-specialist`, an N+1 query → `database-specialist` / `performance-specialist`, even when the path looks generic. Prefer the _most relevant_ reviewers over exhaustive coverage.
3. **Dispatches them in parallel**, each scoped to the in-context diff and reviewing through its own lens.
4. **Merges** findings (dedupe overlaps) and applies the tier rule.

**Concurrency:** keep per-review fan-out small. In `/todo`, review runs _inside_ an already-parallel batch (up to 4 executors), so cap each todo's reviewers at **1–2 (max 3)** to avoid a 4×N subagent blow-up against the project's "max ~4 parallel agents" guidance. A branch-wide review (`/codify`) or an audit may use more (2–4) because it is not itself nested in a parallel batch.

#### Reviewer roster

| Pick when the in-context code touches…               | Agent                                 |
| ---------------------------------------------------- | ------------------------------------- |
| Camera / OCR / vision / barcode / frame processors   | `camera-specialist`                   |
| RN UI / components / animations / theming / layout   | `rn-ui-ux-specialist`                 |
| Accessibility (VoiceOver/TalkBack, WCAG, focus trap) | `accessibility-specialist`            |
| HTTP routes / Express / uploads / premium gates      | `api-specialist`                      |
| Server architecture / layering / SSE / sessions      | `architecture-specialist`             |
| Drizzle / schema / storage modules / migrations      | `database-specialist`                 |
| Security (IDOR, JWT, SSRF, prompt injection, rate)   | `security-auditor`                    |
| AI/LLM / OpenAI / prompts / AI safety / caching      | `ai-llm-specialist`                   |
| Nutrition science / macros / food NLP / Verified API | `nutrition-domain-expert`             |
| Perf (memo, FlatList, TTL caches, Reanimated)        | `performance-specialist`              |
| Strict TS / Zod / type guards / nav typing           | `typescript-specialist`               |
| Tests / Vitest / mocks / testability                 | `testing-specialist`                  |
| Error handling / lint / minimal-changes / todo UX    | `quality-specialist`                  |
| Library/API correctness vs current docs              | `docs-researcher`                     |
| No specific domain / broad cross-cutting / trivial   | `code-reviewer` (generalist fallback) |

`code-reviewer` is the generalist: use it when no specific domain dominates, for broad cross-cutting changes, or as the sole reviewer for a trivial diff. `todo-executor` and `todo-researcher` are workflow drivers, **not** reviewers.

#### Working-tree safety (critical — do not skip)

A dispatched reviewer subagent **does not inherit the orchestrator's worktree cwd**. Its `git` / file commands run against the **main checkout** unless the prompt explicitly `cd`s it into the right tree — so a reviewer told "run `git diff HEAD`" from a `/todo` or `/audit` worktree would see an _empty_ diff in the main checkout, return "No findings", and the review gate would silently pass unreviewed code. To prevent this, the orchestrator MUST:

1. Capture the working tree's absolute path **in its own (correct) cwd**: `WORKTREE=$(git rev-parse --show-toplevel)`, plus the changed-file list (`git diff HEAD --name-only` for working-tree review, or `git diff main...HEAD --name-only` for branch review) and the expected branch/HEAD.
2. Pass all of that into each reviewer, and make the reviewer prompt **begin** with a `cd "$WORKTREE"` and a `pwd && git branch --show-current && git rev-parse --short HEAD` verification — stating the expected branch/HEAD so the reviewer stops if it landed in the wrong tree.

#### Dispatch prompt (per selected reviewer)

```
Agent({
  description: "Review (<domain>): <context label>",
  subagent_type: "<selected agent>",
  prompt: "cd \"<ABSOLUTE WORKTREE PATH>\" && pwd && git branch --show-current && git rev-parse --short HEAD — you must be in tree <expected branch>/<short HEAD>; if not, STOP and report 'wrong working tree'.\n\nThen review ONLY these changed files through your <domain> lens — correctness, security, and OCRecipes pattern compliance:\n<changed-file list>\n\nRun `git diff HEAD -- <those files>` (or `git diff main...HEAD -- <those files>` for branch review) to see the changes; read surrounding code and use LSP for context. Do NOT review unchanged code.\n\nReturn findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n[SUGGESTION] file:line — description\nIf there are no issues, return exactly: No findings."
})
```

#### Tier handling (project convention)

- **CRITICAL** blocks — must be fixed before the work proceeds.
- **WARNING** — fix inline if clearly in-scope and small; otherwise surface it (e.g. `DEFERRED_WARNINGS`) for the user to triage. Never auto-file a follow-up todo.
- **SUGGESTION** — informational; apply only if trivial and in-scope.

#### Selection examples

- `client/screens/ScanScreen.tsx` → `camera-specialist` + `rn-ui-ux-specialist`
- `server/routes/recipes.ts` with a new auth check → `api-specialist` + `security-auditor`
- `server/storage/cookbooks.ts` ownership-filter change → `database-specialist` + `security-auditor`
- a new Zod schema in `shared/` → `typescript-specialist`
- bumping a library / new third-party API usage → add `docs-researcher`
- a docs-only / config-only diff, or a tiny cross-cutting change → `code-reviewer`

#### Self-improving

Any review finding that reveals a reusable rule feeds back — via `/codify` (`.claude/skills/codify/SKILL.md`) — into both `code-reviewer.md` and the matching specialist agent, so the roster sharpens over time. For a quick, generic, non-pattern-aware diff pass, the built-in `/code-review` skill is also available.

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
