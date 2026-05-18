# AI Workflow

This document is written for AI coding agents (Claude Code and similar tools) working in this repository. It explains the quality-gate infrastructure, delegation tooling, and conventions that reduce token overhead without sacrificing correctness.

For human contributor setup, see [DEV_SETUP.md](DEV_SETUP.md).

---

## Quality Gates

## Review Policy

Use a hybrid review model in this repo:

- `kimi-review` is the default for ordinary commits, pre-commit checks, and repetitive implementation loops where diff-based review is sufficient.
- The code-reviewer and specialist subagents remain active for deep audit-style inspection where cross-file reasoning is worth the token cost.
- Audit workflows may intentionally use the deeper subagent path even when other workflows use Kimi.

### Review Routing Matrix

Use this decision table before choosing a review path:

| Situation                                                                                                | Default review path                                         | Why                                                                  |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| One local change or one bounded feature slice                                                            | `kimi-review --patterns ...`                                | Diff-based review plus domain patterns is usually enough             |
| Repetitive per-task or pre-commit review loop                                                            | `kimi-review --patterns ...`                                | Lowest token cost for repeated checks                                |
| Cross-domain diff touching 2-3 risky areas                                                               | `kimi-multi-review`                                         | Parallel domain passes surface issues better than one generic review |
| Change modifies plan intent, architecture boundaries, or interactions across 3+ subsystems               | deep subagent review                                        | Needs wider reasoning than a diff and pattern bundle usually provide |
| Audit finding verification after local fix                                                               | local test/check first, then keep audit Phase 6 deep review | Audits already pay for broader cross-file inspection                 |
| Security, health-data, auth, receipt validation, or other high-blast-radius changes with ambiguous scope | specialist subagent review, optionally after Kimi           | Human-readable deep reasoning matters more than review throughput    |

Escalate from `kimi-review` to a deep subagent when any of these are true:

- The diff is small but the behavior depends on several untouched files.
- The change rewrites ownership, caching, transactions, navigation flow, or AI prompt boundaries.
- Kimi findings are ambiguous because the real risk is architectural rather than local.
- You need plan-vs-implementation judgment, not just code-quality findings.
- The touched domain is one where false negatives are expensive: auth, health data, payments, destructive mutations.

### Review Checklist

Use this quick checklist before choosing a reviewer and again when summarizing review coverage:

- What is the narrowest review path that still matches the real risk: `kimi-review`, `kimi-multi-review`, or deep subagent?
- Which domain patterns actually apply to the touched files?
- Does the behavior depend on important untouched files or only on the diff?
- Is the main risk local correctness, or broader architecture / plan alignment?
- Would a false negative be unusually expensive here because of auth, health data, payments, caching, destructive mutations, or AI safety?
- If using Kimi: did you pass the right `--patterns`, or should this escalate instead?
- If using deep subagents: is the extra token cost justified by cross-file reasoning rather than habit?
- After review: did the chosen path actually cover the domains that changed, or is a second targeted pass still needed?

Copy-paste version:

```md
Review checklist:

- Chosen path: `kimi-review` / `kimi-multi-review` / deep subagent
- Relevant patterns: ...
- Depends on untouched files? yes/no
- Risk type: local correctness / cross-file architecture / plan alignment
- High-blast-radius domain? yes/no
- Escalation needed? yes/no
- Second targeted pass needed? yes/no
```

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on pushes to `main` and on pull requests. It also cancels superseded in-progress runs for the same ref, which avoids burning Actions minutes on stale commits.

Documentation-only pushes to `main` (`*.md`, `docs/**`, `todos/**`) are ignored so they do not spend full lint/type/test minutes. Pull requests still run CI so required status checks are always reported.

- ESLint (including accessibility, hardcoded-color, and IDOR custom rules)
- `tsc --noEmit` type check
- Full Vitest suite (`npm run test:run`)

**Why tests don't need to run locally before commits:** CI is the authoritative quality gate. The pre-commit hook runs `lint-staged` plus a staged-diff `kimi-review` check for `.ts`/`.tsx` changes when the CLI is available. It does not run `tsc` or `npm test`. Running the full test suite in the hook added ~20s to every commit and produced no signal that CI didn't already catch. If CI fails, the PR is blocked.

When CI fails, inspect only failed step logs:

```bash
npm run ci:failed-logs
# or for a specific run:
npm run ci:failed-logs -- <run-id>
```

Do not paste full workflow logs into Claude. Failed-step logs are the useful signal.

### Kimi Review CI

`.github/workflows/kimi-review.yml` is an opt-in PR gate for TypeScript review. It runs only for `.ts`/`.tsx` pull request diffs and only when the repository variable `KIMI_REVIEW_CI_ENABLED` is set to `true`.

When enabled for same-repo PRs, the workflow runs `scripts/ci-kimi-review.sh` over the PR base/head diff. CRITICAL findings fail the job; WARNING findings print but do not fail. Fork PRs are skipped because repository secrets are unavailable to untrusted forks.

To enable the gate, provision `kimi-review` on the GitHub runner, set either `WORKER_API_KEY` or `MOONSHOT_API_KEY` as a repository secret, then set repository variable `KIMI_REVIEW_CI_ENABLED=true`. If the variable is enabled but the CLI or secret is missing, the job fails with an explicit setup error.

### Pre-commit Hook (Husky / lint-staged / kimi-review)

`.husky/pre-commit` always runs `lint-staged`. Staged `.ts`/`.tsx` files get ESLint auto-fix + Prettier, and then the hook runs `kimi-review` on the staged TypeScript diff with `--tiers CRITICAL,WARNING --profile ocrecipes`.

CRITICAL Kimi findings block the commit. WARNING findings are printed but do not block. The Kimi gate is intentionally best-effort for local developer ergonomics: it skips when no `.ts`/`.tsx` files are staged, when `SKIP_KIMI_REVIEW=1` is set, or when `kimi-review` is not on `PATH`. Teammates without the Kimi CLI still get lint-staged locally and CI remains the authoritative shared gate.

The hook does **not** run `tsc` or `npm test` — CI owns those.

### CLAUDE.md

`CLAUDE.md` is **gitignored intentionally**. It is an AI instruction file, not project source. Checking it in would expose internal agent directives, bloat the repo, and make it harder to evolve AI-specific guidance independently from the codebase.

---

## Cheap-Worker Delegation (kimi-\* Tools and Copilot Issues)

The following CLI scripts are available globally and should be used to offload work that doesn't require the main agent's full reasoning capacity. Delegating reduces context usage and speeds up the session.

GitHub Copilot can also handle bounded repo-local tasks through GitHub Issues assigned to `@copilot`. Prefer the `kimi-*` tools below for cheap read/write/review/challenge passes; use Copilot Issues for tracked, tightly scoped deferred work where Copilot can open a normal pull request for human review.

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

### `kimi-review`

**When:** Before committing any significant implementation, and as the default reviewer in repetitive implementation loops. Diffs only changed lines and returns findings at CRITICAL/WARNING/SUGGESTION tiers.

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

Use the narrowest combination that still covers the changed domain. Default mappings in this repo:

| Change area                                   | Recommended `--patterns`               |
| --------------------------------------------- | -------------------------------------- |
| Express routes / middleware                   | `api,security,architecture`            |
| Storage, schema, migrations                   | `database,security,architecture`       |
| React Native screens/components/navigation    | `react-native,design-system,animation` |
| Hooks / TanStack Query / client request state | `hooks,client-state,react-native`      |
| AI services / prompts / evals                 | `ai-prompting,security,testing`        |
| Performance-sensitive changes                 | `performance,react-native,database`    |
| Type-heavy refactors / shared contracts       | `typescript,architecture`              |
| Tests validating risky contracts              | `testing,typescript`                   |

The staged-commit hook auto-derives this pattern list from changed file paths. For manual reviews, add the matching `--patterns` yourself so Kimi gets domain-specific conventions close to what the deeper subagents would apply.

If you cannot name a clean pattern set because the change spans several unrelated concerns, that is usually a signal to escalate to `kimi-multi-review` or a deep subagent instead of forcing a single overloaded `kimi-review` pass.

`--patterns security,api` expands to `docs/legacy-patterns/security.md` and `docs/legacy-patterns/api.md`. Keep the list narrow so Kimi gets the relevant conventions without turning every review into a large context dump.

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
| Pattern lookups via `ask-kimi --paths docs/legacy-patterns/X.md`       | Avoids Claude re-reading pattern files each session                                  |
| `kimi-review` for repetitive review loops                              | Diffs changed lines only; cheaper than repeated deep-review subagent passes          |
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
