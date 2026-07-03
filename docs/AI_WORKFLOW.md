# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

## Review Policy

Code review is **orchestrator-dispatched, domain-selected, and scoped to the code in the current context** — the session's changed / working-tree files, never a repo-wide re-review. This section is the single source of truth; `/todo` (Step 6), `/audit` (Phases 3 + 6), `/codify` (Step 3), and on-demand reviews all follow it.

At review time the orchestrator (the `todo-executor` for `/todo`, the `/audit` skill for its review phases, or the main session for an on-demand review):

1. **Inspects the in-context diff** — both file **paths** and **content**.
2. **Always dispatches `code-reviewer`** as the cross-cutting baseline (it carries the broad OCRecipes pattern + correctness checklist — TypeScript strict-mode, code quality, testing — that catches stray issues outside any single domain, e.g. a rogue `as` cast or a missing error boundary), **plus selects the relevant domain reviewers** for depth — typically **1–2 more**. Path is a starting hint (the `docs/rules/<domain>` mapping); **content overrides it** — a JWT call → add `security-auditor`, an N+1 query or route change → add `server-reviewer`, a screen or camera change → add `mobile-reviewer`, even when the path looks generic. For a docs/config-only or trivial diff, `code-reviewer` alone is enough.
3. **Dispatches them in parallel**, each scoped to the in-context diff and reviewing through its own lens.
4. **Merges** findings (dedupe overlaps) and applies the tier rule.

**Concurrency:** keep per-review fan-out small. In `/todo`, review runs _inside_ an already-parallel batch (up to 4 executors), so cap each todo at **`code-reviewer` + 1–2 domain reviewers (≤3 total)** to avoid a 4×N subagent blow-up against the project's "max ~4 parallel agents" guidance. A branch-wide review (`/codify`) or an audit may use more (`code-reviewer` + 2–3 domain reviewers) because it is not itself nested in a parallel batch.

#### Reviewer roster

| Pick when the in-context code touches…                                                | Agent                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------ |
| HTTP routes / Express / architecture & layering / SSE / Drizzle / schema / migrations | `server-reviewer`                          |
| RN UI / theming / accessibility / camera & OCR / barcode / client performance         | `mobile-reviewer`                          |
| AI/LLM / OpenAI / prompts / AI caching & cost / nutrition science / food NLP          | `ai-reviewer`                              |
| Security (IDOR, JWT, SSRF, prompt injection, rate limiting)                           | `security-auditor`                         |
| Cross-cutting baseline (strict TS / Zod / tests / quality) — **always dispatched**    | `code-reviewer` (+ domain reviewers above) |

`code-reviewer` **always** runs as the cross-cutting baseline; the domain reviewers are selected on top of it for depth (and `code-reviewer` is the _sole_ reviewer only for a docs/config-only or trivial diff). `todo-executor` and `todo-researcher` are workflow drivers, **not** reviewers.

#### Working-tree safety (critical — do not skip)

A dispatched reviewer subagent **does not inherit the orchestrator's worktree cwd**. Its `git` / file commands run against the **main checkout** unless told otherwise — so a reviewer told "run `git diff HEAD`" from a `/todo` or `/audit` worktree would see an _empty_ diff in the main checkout, return "No findings", and the review gate would silently pass unreviewed code. To prevent this, the orchestrator MUST:

1. Capture the working tree's absolute path **in its own (correct) cwd**: `WORKTREE=$(git rev-parse --show-toplevel)`, plus the changed-file list (`git diff HEAD --name-only` for working-tree review, or `git diff main...HEAD --name-only` for branch review) and the expected branch/HEAD.
2. Pass all of that into each reviewer, and require the reviewer to address `$WORKTREE` explicitly: use **`git -C "$WORKTREE" …`** for every git command and **read files at `$WORKTREE/<path>`** — do **not** `cd`. (A leading `cd` in a compound command can trigger a permission prompt, which stalls an autonomous `/todo` run; `git -C` is dependency-free.) The reviewer prompt must **begin** with a tree check — `git -C "$WORKTREE" rev-parse --abbrev-ref HEAD` + `--short HEAD` must match the expected branch/HEAD, else STOP and report "wrong working tree".

#### Dispatch prompt (per selected reviewer)

```
Agent({
  description: "Review (<domain>): <context label>",
  subagent_type: "<selected agent>",
  prompt: "Your ambient cwd is the main checkout, NOT the tree under review. Use `git -C \"<WORKTREE>\"` for every git command and read files at <WORKTREE>/<path>; do not cd.\n\nFirst confirm the tree: `git -C \"<WORKTREE>\" rev-parse --abbrev-ref HEAD` and `git -C \"<WORKTREE>\" rev-parse --short HEAD` must be <expected branch>/<short HEAD> — if not, STOP and report 'wrong working tree'.\n\nThen review ONLY these changed files through your <domain> lens — correctness, security, and OCRecipes pattern compliance:\n<changed-file list>\n\nRun `git -C \"<WORKTREE>\" diff HEAD -- <those files>` (or `git -C \"<WORKTREE>\" diff main...HEAD -- <those files>` for branch review) to see the changes; read surrounding code at <WORKTREE>/<path> and use LSP for context. Do NOT review unchanged code.\n\nReturn findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n[SUGGESTION] file:line — description\nIf there are no issues, return exactly: No findings."
})
```

#### Tier handling (project convention)

- **CRITICAL** blocks — must be fixed before the work proceeds.
- **WARNING** — fix inline if clearly in-scope and small; otherwise surface it (e.g. `DEFERRED_WARNINGS`) for the user to triage. Never auto-file a follow-up todo.
- **SUGGESTION** — informational; apply only if trivial and in-scope.

#### Selection examples

Every review includes `code-reviewer` (baseline); the domain reviewers below are added on top.

- `client/screens/ScanScreen.tsx` → `code-reviewer` + `mobile-reviewer`
- `server/routes/recipes.ts` with a new auth check → `code-reviewer` + `server-reviewer` + `security-auditor`
- `server/storage/cookbooks.ts` ownership-filter change → `code-reviewer` + `server-reviewer` + `security-auditor`
- a new Zod schema in `shared/` → `code-reviewer` alone (Zod/type-guard rigor is its baseline lens)
- bumping a library / new third-party API usage → the reviewer verifies against current docs via the Context7 MCP tools (`mcp__claude_ai_Context7__resolve-library-id` / `query-docs`) or WebSearch
- a docs-only / config-only or tiny cross-cutting diff → `code-reviewer` alone

#### Self-improving

Any review finding that reveals a reusable rule feeds back — via `/codify` (`.claude/skills/codify/SKILL.md`) — into exactly **one** owning reviewer file (single-write; the routing table lives in codify Step 5), so the roster sharpens over time without dual-write drift. For a quick, generic, non-pattern-aware diff pass, the built-in `/code-review` skill is also available.

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

## Cheap-Worker Delegation (kimi-\* Tools)

The following CLI scripts are available globally, **on explicit user request only** — never invoke them automatically. Never point them at JWT auth, IAP receipt validation, or user health data. (The Copilot Issue-delegation pipeline was deleted 2026-07; routine todos go through the `/todo` skill.)

### `ask-kimi`

**What:** Bulk file Q&A — pattern lookups, summarization, cross-file questions.

```bash
ask-kimi --paths docs/legacy-patterns/api.md server/routes/carousel.ts --question "Does this route follow the error-response pattern?"
```

### `kimi-write`

**What:** Boilerplate generation closely matching an existing reference file (new route, new storage module, new hook).

```bash
kimi-write --reference server/routes/nutrition.ts --target server/routes/carousel.ts --description "GET /api/carousel"
```

### `kimi-challenge`

**What:** Adversarial pressure-test of a stated decision (navigation patterns, camera flows, state management).

```bash
kimi-challenge --decision "use X-User-Hour header (integer) vs X-User-Timezone (IANA string) for carousel time-of-day"
```

Returns a structured for/against analysis. Claude makes the final call; kimi-challenge stress-tests the reasoning.

### `extract-chat`

**What:** Strips a previous Claude Code session transcript before it re-enters context. Reads Claude Code JSONL logs and drops tool calls, thinking blocks, signatures, binary data, and framework-injected messages, leaving only conversation text.

```bash
extract-chat "$VSCODE_TARGET_SESSION_LOG" -o /tmp/session-chat.txt
```

This keeps historical session context lean before it re-enters Claude's context window. It does not process arbitrary `kimi-*` stdout.

---

## Token-Saving Conventions

| Convention                                                                       | Reason                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| code-reviewer + domain-reviewer subagents for audits                             | Higher token cost, but better for deep cross-file reasoning and audit-style reviews  |
| iOS/device setup in `docs/DEV_SETUP.md`                                          | Keeps CLAUDE.md short; agents reference the doc, not inline instructions             |
| Durable architecture facts in auto-memory (`MEMORY.md` → Key Architecture Notes) | Schema, nav, services, stack facts persist across sessions without re-reading source |

## Drift Checklist

The canonical recurring drift list lives in `docs/AI_DRIFT_CHECKLIST.md`. Keep IDs stable, update the status fields instead of renaming rows, and add new drift-prone items there rather than duplicating checklist logic in multiple docs. It is reviewed manually — no scheduled checker exists.
