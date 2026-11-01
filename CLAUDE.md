# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git Workflow

- Never commit or push directly to `main`. Always create a feature branch and open a PR for review, even for small changes.
- Never use destructive git commands (`git reset --hard`, `rm -rf`); prefer `--mixed` resets and read-only state inspection unless explicitly authorized.

## Development Process

- Follow strict TDD: write a failing test first, then implement, and verify all tests pass before opening a PR.

## Worktree Isolation

- When doing isolated work, always write output files (reports, trends) into the designated worktree, never the main checkout.

## Project Overview

OCRecipes is a mobile nutrition tracking app built with Expo/React Native (frontend) and Express.js (backend). Users scan food barcodes/labels with their camera, track nutritional intake, plan meals with recipes, and receive AI-powered nutrition advice via chat.

## Workflow Standards

- **Ad-hoc worktree sessions declare a contract:** after creating/entering a worktree outside `/todo`/`/todo-fast` (e.g. via `superpowers:using-git-worktrees`), run `bash scripts/declare-worktree.sh "$(git rev-parse --show-toplevel)"` — the PreToolUse guards then DENY out-of-contract mutations in their covered scope: file-tool writes (Edit/Write/MultiEdit/NotebookEdit), mutating git commands, and absolute-path write-shaped Bash (`>`, `>>`, `tee`, `rm`, `cp`/`mv` dest, `sed -i`) targeting the main checkout. Relative-path shell writes after `cd` and arbitrary interpreter writes (`node -e`) are NOT covered (spec-documented residual — `docs/superpowers/specs/2026-07-17-git-guardrails-design.md`). Release with `--remove`/`--clear` when done. Bypass one command with `SKIP_WORKTREE_CONTRACT=1`. **Exception:** `/audit` worktrees never declare — the audit skill writes its manifest/CHANGELOG to the main checkout by design (see audit SKILL.md Phase 1 contract note).
<!-- Core discipline guardrails (think-before-coding, simplicity, surgical changes,
     goal-driven execution) are injected at edit time by .claude/hooks/inject-patterns.sh
     and intentionally NOT duplicated here. -->
- After code review, ALWAYS check for emergent patterns and codify them in the patterns docs.
- If architecture facts changed, persist them concisely to your auto-memory architecture notes (`MEMORY.md` → Key Architecture Notes) instead of re-reading large source files in future sessions.
- At codify time, any memory marked RESOLVED/SHIPPED/MERGED gets reduced to a one-paragraph durable takeaway or deleted — plan archaeology does not accrete.
- CI enforces lint/types/tests/coverage on every push and is the source of truth (8 required checks on `main`). Do NOT run `test:run`, `check:types`, or `lint` ad-hoc mid-session to self-verify. **Exception (owner ruling 2026-10-02):** the `/todo` executor's Step 5b full-suite run (`.claude/agents/todo-executor.md`, restated in its Step 6 and by `/todo-fast`) and the code-reviewer checklist's schema-change full-run check are sanctioned pipeline gates, not ad-hoc self-verification — executors and reviewers run them as written. Locally: **commits run lint-staged only** (fix/format + cheap pattern checks — no semantic gate); **every push runs `preflight:fast`** (type-aware lint on changed files + whole-program tsc + related tests + CI's cheap pattern checks gated on the paths they cover; whole-repo lint when eslint config/deps change) and writes a HEAD pass-stamp **when the gate completes** (a docs-only push with zero changed TS/hook files stamps having run no tests — deliberate; the stamp is refused when related tests were skipped for an unreachable Postgres, and in `--uncommitted` mode), and is **skipped when HEAD is already stamped** (so a push never re-verifies the same commit twice). `npm run preflight` (full CI parity incl. coverage) is **on-demand only**. PR creation (`gh pr create` **or** `mcp__github__create_pull_request`) is gated by `.claude/hooks/pr-preflight-guard.sh`, which accepts **any** fresh HEAD-matching stamp (the fast gate's stamp is enough — coverage is CI's job, not the local guard's), and — when the PR changes a guard or keyword file listed in `scripts/harness/verdict-diff/targets.tsv` — also a verdict-diff stamp for that commit: run `bash scripts/harness/verdict-diff.sh`, which lists every verdict that changed between base and head over a generated set; paste the lists into the PR body under `## Verdict changes` (bypass `SKIP_VERDICT_DIFF=1`). Bypasses: `git commit/push --no-verify`, `SKIP_PR_PREFLIGHT=1`. Gate output is quiet on success — one `▶`/`✔` line per step, full output dumped only on failure; `PREFLIGHT_VERBOSE=1` streams it live.
- When CI fails, inspect only failed step logs via `npm run ci:failed-logs` (or `npm run ci:failed-logs -- <run-id>`). Do not dump full workflow logs into context.
- Prefer the `LSP` tool over `grep` for symbol work (find-references, go-to-definition, hover, rename-safety) — it matches semantic identity and resolves the `@/` / `@shared/` aliases. Cold-start gotcha: the first query can return degraded results; if a result looks impossibly small, re-run it once (a `hover` call warms the server). When delegating symbol work to non-editable agents (`Explore`, `Plan`, `feature-dev:*`), include the LSP-first + warm-up directive in the dispatch prompt. Full rules and the underused ops (`incomingCalls`/`outgoingCalls`, `goToImplementation`, `workspaceSymbol`): `docs/rules/lsp.md`.
- **Generic skill review steps → the reviewer roster, not `general-purpose`:** when a portable (non-OCRecipes-aware) skill dispatches a subagent for a _review_ verdict — e.g. superpowers `subagent-driven-development`'s task-reviewer, `requesting-code-review` — route it through the `docs/AI_WORKFLOW.md` → Review Policy roster (`code-reviewer` baseline + selected domain reviewers) instead of the skill's default bare `general-purpose`. This does NOT apply to _implementation_ subagents in those same skills (e.g. the implementer step, or `dispatching-parallel-agents`' fix-the-tests dispatch) — every roster reviewer is read-only (no Edit/Write), so code-writing dispatches keep `general-purpose`.
- Cheap-worker (kimi-\*) scripts are **explicit-request only outside the sanctioned skill-embedded uses** enumerated in `docs/AI_WORKFLOW.md` → Cheap-Worker Delegation — see **Cheap-Worker Delegation** below.
- Prefer the GitHub MCP tools (`mcp__github__*`) over raw `gh` via Bash for PR/issue/review/status operations — they return structured data and avoid local git-state confusion. The tools are deferred, so load schemas with `ToolSearch` (`select:mcp__github__...`) before first use. Keep `gh`/`npm run ci:failed-logs` only for things the MCP server doesn't cover, chiefly CI failed-step log inspection. (This overrides the default "use gh for all GitHub tasks" guidance.)
- Push commits to origin after a clean review cycle unless user says otherwise.
- Before reporting test/CI results, confirm exit codes are real (not trailing-echo artifacts) and re-run LSP queries if the language server may still be cold-indexing.
- **Parallel-terminal git drift:** A `.claude/hooks/drift-detect.sh` PreToolUse hook fires before every `git commit`/`git push` and warns (never blocks) if HEAD advanced externally since Claude's last git op. Worktree isolation (**opt-in, not default**) is the stronger fix for long multi-edit sessions where the user is also working in the same checkout — use `superpowers:using-git-worktrees` to set one up.

## Development Commands

Footgun annotations only — the full script list lives in `package.json`; do not restate it here.

```bash
# Dev loop: npm run server:dev (Express :3000) + npx expo run:ios (simulator, native modules).
# Expo Go (npm run expo:dev) has NO camera support — camera features need the dev-client build.

npm run db:push       # Drizzle schema push; first time only:
                      #   psql $DATABASE_URL -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

npm run seed:recipes  # dev/test only — refuses NODE_ENV=production without --allow-prod-seed.
                      #   SEED_DEMO_PASSWORD=... for a reproducible demo login (default: random, printed once)
npm run cleanup:seeds # removes seed + test recipes (orphan/demo-authored ONLY)

npm run backfill:recipe-images   # refreshes OUR AI hero images IN PLACE (overwrites R2 keys);
                                 #   -- --dry-run classifies only (ours/external/none), no spend. After a real
                                 #   run, purge the Cloudflare cache for recipe-images/* so the CDN serves the new bytes.

# EAS Update (OTA JS delivery) — --message is REQUIRED (script refuses an unlabeled publish)
npm run update:preview -- --message "fix login"    # OTA to branch `preview`    (iOS + Android)
npm run update:production -- --message "ship it"   # OTA to branch `production` (iOS + Android)
# Both scripts bake in the three publish footguns (see reference_eas_update_ota memory):
#   CI=1, EXPO_PUBLIC_DOMAIN, and EXPO_PUBLIC_SENTRY_DSN inlined from the shell,
#   and --platform all (web is excluded via app.json platforms). Do NOT pass --platform
#   yourself (the script locks it and rejects a forwarded --platform).
```

## Architecture

Monorepo: `client/` (React Native/Expo frontend), `server/` (Express backend — domain-split `routes/`, `storage/`, `services/`, each composed/registered via its index), `shared/` (database schema — 40+ tables in `shared/schema.ts` — models, constants, types). Path aliases: `@/` → `./client`, `@shared/` → `./shared`. Stack versions are derivable from `package.json` and are not restated here.

**Navigation flow:** Login → Onboarding (6 screens) → Main App. Main tabs: **Home**, **Plan**, **Coach**, **Profile** — Scan is a floating action button (FAB) that opens a fullScreenModal, not a tab. Root-level modal screens are registered in `client/navigation/RootStackNavigator.tsx` (see the `RootStackParamList` type) — consult it for the current list rather than maintaining one here.

**Deep linking** is configured in `client/navigation/linking.ts` (wired via `linking` prop on `NavigationContainer` in `App.tsx`) — prefixes `ocrecipes://` / `https://ocrecipes.com`; consult the file for the current path list rather than maintaining one here. See `docs/legacy-patterns/react-native.md` → "Deep Linking Configuration" for the full pattern.

**Key AI services** (`server/services/`): `photo-analysis.ts` (4 intents, confidence scoring), `nutrition-coach.ts` (chat), `recipe-chat.ts`, `recipe-generation.ts` (premium). Nutrition lookup fallback order (`nutrition-lookup.ts`): CNF → USDA → API Ninjas.

## Key Patterns

Domain-specific rules and solutions are **auto-injected** on `Edit`/`Write`/`MultiEdit` via `.claude/hooks/inject-patterns.sh`, reading `docs/rules/<domain>.md` (binding, short by design) and the git-tracked **`docs/solutions/*.md` corpus** — the canonical store (the former `ocrecipes_solutions` DB/pgvector layer and its MCP server are retired). Matching is a `^tags:` frontmatter grep, so solution frontmatter arrays must stay single-line inline-flow — `scripts/check-solution-frontmatter.js` (lint-staged) enforces this and the required fields; `docs/solutions/` is in `.prettierignore` for the same reason. Path-to-domain mapping is generated into `.claude/hooks/lib/domain-map.sh` from `scripts/lib/path-domains.ts` (never hand-edit the generated file; `build:domain-map:check` drift-checks it in CI). When the injection exceeds the hook-output cap, content gracefully spills to a temp file — read it like any other file. The hook also emits fail-silent PG Lab telemetry (kill switch `PATTERN_INJECT_NO_LOG=1`; refuses the app DBs). After implementing, codify novel knowledge via `/codify` (write the solution file, commit it) — see `.claude/skills/codify/SKILL.md`. Full knowledge-base layout — `docs/rules/`, the `docs/solutions/` corpus, and the frozen `docs/legacy-patterns/` archive — documented in `docs/PATTERNS.md`.

**Parallel Bash tool calls:** Never issue more than 4 independent `Bash` tool calls in a single response. When results look inconsistent or a command appears to have failed without explanation, re-run it alone before diagnosing. Sequential commands within a single `Bash` call (`&&`, `;`) are unaffected by this limit.

**Verifying before reporting:** Before reporting a PR number, merge status, commit hash, or test count, always verify with a fresh tool call. Never cite values from prior conversation context — they may be stale or from a different session.

### Copilot Instructions (PR review only; delegation deleted)

`.github/copilot-instructions.md` is generated from `scripts/build-copilot-instructions.ts` and consumed by Copilot PR reviews — if you change `docs/rules/*.md` or the path → domain mapping, run `npm run build:copilot-instructions` and commit the regenerated file (CI's `build:copilot-instructions:check` fails otherwise). Routine todos go through the `/todo` skill (the Issue-delegation pipeline is retired).

### Code Audits

Use `/audit [scope]` for structured audits — manifest tracking, per-fix verification, dedup, zero-open-findings close. Scopes and process: `.claude/skills/audit/SKILL.md`.

### Deferred Item Todos

Most things you notice mid-session must NOT become a todo. The old "file everything deferred" rule buried the backlog and made finishing one todo spawn three. The bar now:

- **Defect, regression, or blocker (High or Critical severity)** — never **AUTO**-file; always ask first. This gates WHO decides, not whether the item can ever become a todo — a high/critical finding may still end up as one, but only after a human says so.
  - If it is in scope of the current task, fix it now.
  - If it is genuinely out of scope, surface it in your reply: one line, severity, file path. Let the user decide. Do NOT file it **silently**.
- **Defect, regression, blocker, or minor followup (Medium or Low severity)** — this is the ONLY tier that auto-becomes a todo, no "want a todo?" gate.
  - If it is in scope of the current task, fix it now.
  - Otherwise, auto-file it immediately. These are disposable at the low end and real-but-non-blocking at the medium end; the user bulk-prunes or promotes them later.

Medium/Low auto-file flow (run immediately after identifying the item, for either severity in this tier):

1. **Create** `todos/P{n}-YYYY-MM-DD-[slug].md` from `todos/TEMPLATE.md`, where `P{n}` and `priority:` both match the severity you just assessed — `P2`/`priority: medium` for a medium finding, `P3`/`priority: low` for a low finding (see `todos/README.md` for the full priority-prefix mapping). Never hardcode `P3`/`low` regardless of the actual finding. Set `status: backlog` and `labels: [deferred, <domain>]`. Fill **Background** (why it was deferred), **Acceptance Criteria** (checkboxes), and **Implementation Notes** (technical details and explicit file paths in scope).
2. Mention the new todo path in your reply so the user knows it exists.

**Guard-eligible PRs auto-merge; everything else waits for individual review.** A `low`-priority, non-`security` todo whose PR passes `scripts/todo-automerge-guard.sh` (safe-path allowlist) gets GitHub's native `gh pr merge --auto --squash --delete-branch` armed by the executor immediately after PR creation — it lands on its own the moment CI goes green, no human step. `medium`/`high`/`critical` todos, any `security`-labelled todo, and any PR the guard HOLDs or can't evaluate are always surfaced individually for human review, never auto-merged. The executor never force-pushes or deletes a remote branch. Direct push to `main` is rejected by branch protection.

Pattern codification (`docs/solutions/`, `docs/rules/`) is exempt from this bar — it writes docs, not todos.

**Exception — guard/hook findings:** findings against `.claude/hooks/**` go to `docs/harness-residuals.md`, never a todo (guard hardening frozen, user ruling 2026-09-22). One review pass per PR, plus at most one confirmation pass when CRITICALs or small in-scope WARNINGs were fixed on the branch — see `docs/AI_WORKFLOW.md` → Review Policy.

Backlog todos are picked up later via the `/todo` skill, which works on them locally with full session context.

## Testing

Vitest, with tests co-located in `__tests__/` directories beside the code under test (plus the `client/components/*-utils.ts` pattern: pure functions extracted from components so Vitest can cover them). Pre-commit hooks run lint-staged only (ESLint fix + Prettier + accessibility/color/IDOR checks — fast, no test suite); CI enforces the full test/type/lint gate on every push.

## Environment Variables

**Core:** `DATABASE_URL`, `JWT_SECRET`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `RUNWARE_API_KEY` (image gen, falls back to DALL-E), `SPOONACULAR_API_KEY`, `USDA_API_KEY`, `API_NINJAS_KEY`, `ADMIN_USER_IDS`, `LOG_LEVEL`, `R2_PUBLIC_BASE_URL` (CDN base for stored images; also gates the backfill's "ours" image classification), `IMAGE_ART_DIRECTOR_LLM` (set to `off` to disable the per-image LLM art-director pre-pass — defaults on when OpenAI is configured; the deterministic style library still runs), `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines — Vertex AI direct for the vision rows marked `primary: "vertex"`; a dedicated service account, never the Play IAP one; unset = those rows start at OpenRouter, and they never fall back to OpenAI), `SENTRY_DSN` (server-side Sentry error tracking — 5xx + crash capture, requestId-tagged; only active in `NODE_ENV=production`; distinct from the client's `EXPO_PUBLIC_SENTRY_DSN`)

**Expo push:** `EXPO_PUBLIC_DOMAIN` (API domain for client), `EXPO_ACCESS_TOKEN` (server-side; omit to disable server-driven push), `EXPO_PUBLIC_PROJECT_ID` (required alongside `EXPO_ACCESS_TOKEN`)

**Apple IAP:** `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PEM), `APPLE_BUNDLE_ID`, `APPLE_ENVIRONMENT` (sandbox/production), `APPLE_APP_ID` (numeric, required for prod JWS), `APPLE_ROOT_CA_DIR` (defaults to `server/certs/`), `RECEIPT_VALIDATION_STUB` (`"true"` for dev stub mode)

**Google IAP:** `GOOGLE_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines)

**Evals (not used in production):** `OPENROUTER_API_KEY` (REQUIRED — eval generation runs through OpenRouter with the fallback off; also the preferred judge backend), `ANTHROPIC_API_KEY` (judge via Anthropic direct when no OpenRouter key), `EVAL_JUDGE_MODEL` (default `anthropic/claude-sonnet-4.6` via OpenRouter, `claude-sonnet-4-6` via Anthropic direct; used as given), `--candidate "feature=provider/model[;k=v]"` + `npm run eval:paired -- --baseline-file A --candidate-file B` for model switches, `EVAL_SAMPLES_PER_CASE` (1-10, default 1), `EVAL_PARALLELISM` (1-10, default 1). Runner refuses `NODE_ENV=production` without `--allow-prod`.

## iOS / Device Setup

See `docs/DEV_SETUP.md` for full iOS Simulator and physical device setup instructions, IP configuration, and troubleshooting.

## Cheap-Worker Delegation

For code review before a PR, use the `code-reviewer` subagent (Agent tool) or `/code-review` skill — never a kimi script. Kimi scripts stay **explicit-request only** here too, except the sanctioned skill-embedded invocations enumerated in `docs/AI_WORKFLOW.md` → Cheap-Worker Delegation (spec-review prior-spec brief, todo-executor knowledge digest + codification, audit dedup digest + deferred boilerplate, planning pre-read digest), each with its own skip gate and Explore fallback. OCRecipes-specific absolute exclusion: JWT auth, IAP receipt validation, user health data.
