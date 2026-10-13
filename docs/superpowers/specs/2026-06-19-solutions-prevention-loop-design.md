# Closing the prevention loop: pre-push gate + automatic known-issue surfacing

**Date:** 2026-06-19
**Status:** Design approved — pending spec review, then `writing-plans`
**Author:** Claude (brainstorming session with William)

## Problem

The user reports two recurring pains:

1. Small errors/mistakes that keep needing fixing during work.
2. "PR run failed" emails from CI.

The opening framing was "my solutions DB could be better at surfacing recent, known
issues." Investigation reframed this: the issue is not retrieval ranking — it is that
**known knowledge never reaches the point of action**, for two structurally different
reasons.

### Diagnostic evidence

Recent CI failures (the "PR run failed" emails), by failed step:

| Run         | Branch                  | Failed step                         |
| ----------- | ----------------------- | ----------------------------------- |
| 27804976154 | feat/email-verification | **Lint**                            |
| 27782921480 | feat/signup-email-field | **Tests** (shards 2 & 3 + coverage) |
| 27250495475 | **main**                | **Test** (engine tests)             |
| 27097766605 | feat/phase1-railway     | **Tests** (shard 1 + coverage)      |

Every recent failure is **lint or test** — not a substantive recurring bug. The cause is
structural, confirmed in the hooks:

- **Pre-commit** runs `ESLINT_NO_TYPE_AWARE=1 eslint --fix` on _staged files only_ (plus
  prettier and a few targeted checks). It **disables the type-aware ESLint rules** for
  speed, runs **no `tsc`**, and runs **no tests**.
- **CI** runs the full type-aware `npm run lint`, `check:types`, `test:run` (3 shards),
  and `test:coverage:ci`.
- So a locally-green commit can fail CI on exactly Lint / Types / Tests / Coverage — the
  observed failure set. **A solutions DB cannot prevent a type error, a lint violation, or
  a failing test.** This pain is a _missing local gate_, not a DB problem.

For the _second_ pain (small logic-level errors found while working), the DB **is** the
right lever — but the user confirmed the decisive fact: **"I don't consult the DB first."**
The DB is a _pull_ system (`search_solutions`) in a world where nobody pulls. The only
_automatic_ (push) surface is the PreToolUse inject hook, which fires at Edit time, shows
only 4 solutions per domain, and lets the 392 knowledge-track entries crowd out the 112
bug-track post-mortems.

## Goals

- **G1.** Stop the lint/test "PR run failed" emails by catching those failures locally
  before push, fast enough that bypass (`--no-verify`) is never tempting.
- **G2.** Make recent, known issues surface **automatically (push, not pull)** at the
  moments they would prevent a mistake — without adding skimmable noise.
- **G3.** Give a **queryable on-demand "recent" view** so both the human (CLI) and the
  agent (MCP) can ask "what was logged lately" without hand-writing SQL.

## Non-goals (deferred — YAGNI)

- **Recurrence counter / frequency boost.** Tracking how often an issue-class recurs and
  boosting it. Needs a schema column + codify-flow change. Note as future work.
- **Recency tiebreak inside `search_solutions`.** Only helps when the agent _does_ pull;
  low value given the diagnosis. Deferred.
- **Running the solutions-DB parity gates in CI.** Tracked separately in
  `todos/P3-2026-06-14-solutions-db-gates-in-ci.md`. Out of scope.

---

## Phase 1 — Pre-push gate (Lever A: stops the emails)

### Components

- **`.husky/pre-push`** (new) — selects the mode (below), runs it, aborts the push on failure.
  Must carry the same `sh -e` → bash re-exec preamble as `.husky/pre-commit` (husky runs hooks
  as `sh`; this hook uses arrays / here-strings / stdin parsing that need bash).
- **`npm run preflight:fast`** (new) and **`npm run preflight`** (new) — thin wrappers over
  the _existing_ npm scripts CI already runs, so they cannot drift from CI.
- **PR-creation gate wiring** (new) — the `/todo` skill/executor's `gh pr create` step runs
  `npm run preflight` first; a manual `preflight && gh pr create` alias for hand-made PRs.
  This is the primary coverage chokepoint (see below).

### Coverage chokepoint — hybrid (PR-creation gate + push-detection)

Coverage-threshold failures only surface from the full `preflight` (which runs
`test:coverage:ci`). Two enforcement points together cover **both** PR workflows — push
detection alone misses the dominant one:

1. **At PR creation (primary chokepoint).** Run full `preflight` before `gh pr create`.
   This catches the **single-push `/todo` auto-merge flow** (branch → implement → push once →
   open PR with `--auto` → merge on CI green), where the coverage-bearing push happens
   _before any PR exists_ — so push-detection can never see it. Wiring:
   - The `/todo` skill/executor already owns `gh pr create` — its PR-creation step runs
     `npm run preflight` first and aborts PR creation on failure.
   - For manual PRs, a documented `npm run preflight && gh pr create` (thin wrapper/alias).
2. **On push to a branch with an open PR (secondary).** The `pre-push` hook runs full
   `preflight` instead of `preflight:fast` when `gh pr view --json number --jq .number`
   succeeds for the branch. This covers the **iterate-on-an-already-open-PR** pattern
   (repeated pushes after review), catching a coverage regression introduced _after_ the PR
   opened. `gh` unavailable/unauthenticated ⇒ fall back to `preflight:fast` + a one-line
   warning (never hard-block a push on missing tooling).

**Pre-PR WIP pushes (no PR yet) stay on `preflight:fast`** — fast iteration is intentional;
the PR-creation gate (point 1) is what guarantees coverage before the change can merge.

### `preflight:fast` — default when no open PR, target < ~75s

Mirrors the deterministic, fast slice of CI's `Lint · Types · Patterns` job plus a cheap
test slice:

1. `npm run check:types` (tsc `--noEmit`, whole-program — the unavoidable floor, ~20–40s).
2. type-aware `eslint` on **changed files only** (catches the Lint class without the
   full-project wait). Accepted trade: a rare cross-file lint error slips to full
   `preflight` / CI.
3. The cheap, pure "Patterns" checks: `build:copilot-instructions:check`,
   `lint:suppress:check`, `lsp:check-agent-block` (all deterministic, no DB, ~seconds).
4. `vitest related --run` on changed files — runs only the tests that import the diff.

**Change-set detection:** a `pre-push` hook receives `<local ref> <local oid> <remote ref>
<remote oid>` on stdin. For an existing remote branch, diff `remote_oid..local_oid`; for a
new branch (remote oid all-zeros), diff against the merge-base with `origin/main`. The
resulting file list drives both the scoped eslint and `vitest related`.

### `preflight` — full CI parity (auto on PR-branch pushes + manual)

**Exact CI parity:** full `npm run lint` + all pattern/hook checks + `check:types` +
`npm run test:run` + `npm run test:coverage:ci`. The only mode that catches
**coverage-threshold** drops and cross-module test breaks. Runs at the PR-creation chokepoint
and on pushes to a branch with an open PR (see below), and on demand (`npm run preflight`).

**`db:push` decision:** CI runs `npm run db:push` before its test/coverage jobs. A local full
`preflight` against a stale dev schema could fail spuriously (or pass falsely). The plan must
decide whether `preflight` runs `db:push` first — note it **mutates the dev DB**, so it isn't
free; a guarded/opt-in `db:push` or a documented "push your schema first" precondition are
both acceptable. Resolve during implementation.

### Degradation & escape hatch

- tsc / lint / pattern checks are pure (no DB) and always run.
- Tests need Postgres (`DATABASE_URL`, `db:push`, `pg_trgm`). If Postgres is unreachable,
  `vitest related` **degrades to a printed warning** rather than blocking a push on infra.
- `git push --no-verify` remains the documented emergency bypass. The gate's speed is the
  real defense against habitual bypass.
- The hook fires for **both the user's and the agent's pushes** (the agent runs `git push`
  through Bash), so both are caught. Coexists with the existing `drift-detect.sh` PreToolUse
  hook (different layer — a Claude tool hook vs. a git hook).

### Policy reconciliation (CLAUDE.md — local-only, user-authorized)

`CLAUDE.md` currently says: _"CI enforces lint/types/tests on every push — do NOT run
`test:run`, `check:types`, or `lint` at session start or to self-verify."_ That guidance
stays true **mid-session** (don't burn time/context self-verifying), but is now **completed**
by: _"The `pre-push` hook runs the full gate automatically at the push boundary; run
`npm run preflight` before opening a PR."_ This edit is a Phase 1 task, applied when the gate
lands so the file stays accurate. (`CLAUDE.md` is gitignored — the edit is local-only.)

---

## Phase 2 — Automatic + queryable known-issue surfacing (Lever B: the DB)

### B1 — SessionStart "recent issues" digest (push)

Once per session, emit a compact list of solutions codified in the **last ~14 days,
bug-track first** (title + path + date). This is the "recent known issues" front door the
system lacks today. ~10 lines, seen once — matches the user's "one-shot SessionStart
delivery" preference (no per-turn output).

**Critical implementation note:** the existing `.claude/hooks/session-start.sh` exits early
for local sessions (`[ "${CLAUDE_CODE_REMOTE:-}" != "true" ] && exit 0`) — so the digest
must run **before / independent of** that remote-only guard (the user works locally), and be
emitted via the SessionStart `additionalContext` JSON mechanism (the hook currently outputs
no context). Recommended: a dedicated small emitter (`session-recent-issues.sh` registered
as a SessionStart hook, or a guarded block at the top of `session-start.sh` that runs in both
modes). **Fail-silent** if the DB is unreachable (mirrors the inject hook's markdown
fallback) — never block or error a session start. **Verify first** that the SessionStart hook
event accepts the same `hookSpecificOutput.additionalContext` shape the inject hook uses on
PreToolUse (load-bearing for B1, cheap to confirm before building on it).

### B2 — Inject hook reserves a bug-track slot (push)

Today the 4-per-domain budget in `solutions_from_db` / `solutions_from_markdown` lets the
392 knowledge entries crowd out the 112 bug post-mortems. Reserve **≥1–2 slots for the
newest bug-track solutions** per domain, so a recent known bug always rides along with the
conventions at edit time. Surgical change to the two emitter functions in
`.claude/hooks/inject-patterns.sh`. The `hook-equivalence-check` (`solutions:db:hook-check`)
and `test-inject-patterns.sh` gates must be updated to reflect the new reservation logic and
kept DB↔markdown equivalent.

### B3 — Queryable "recent" view (pull) — user-requested

An on-demand front door for "what's been logged lately," for both consumers:

- **CLI `npm run solutions:db:recent`** (the primary, genuinely-new surface; new
  `scripts/solutions-db/recent.ts`) — `SELECT source_path, title, track, category, severity,
created FROM solutions [WHERE filters] ORDER BY created DESC LIMIT k`, with filters as flags
  (`--days 14 --track bug --category runtime-errors --limit 20`) and human-readable table
  output. Follows the established `solutions:db:<verb>` script naming and uses the existing
  read-only pool (`lib/db`). No embedding / OpenAI call — instant.
- **MCP tool `recent_solutions`** in `scripts/solutions-db/mcp-server.ts` — same query/filters,
  for the agent. **Keep it lightweight** — it overlaps the existing generic `sql` tool (the
  agent can already `SELECT ... ORDER BY created DESC`); its only added value is being a
  discoverable named front door. Do not over-invest; the CLI is where B3's value lives.

Note `created` is the date embedded in the source filename (today's surfacing key). If
discovery-date accuracy ever matters, `ingested_at` (a real timestamptz) is available as an
alternate sort — but `created` keeps B3 consistent with the inject hook and B1.

---

## Data flow

**Phase 1 (push + PR-create):**

- WIP push (no open PR) → husky `pre-push` → `preflight:fast` → [tsc, eslint(changed),
  pattern checks, vitest related(changed)] → pass ⇒ push proceeds / fail ⇒ push aborts.
- Push to a branch with an open PR → husky `pre-push` → full `preflight` (exact CI parity
  incl. coverage).
- PR creation (`/todo` step or manual alias) → `npm run preflight` → exact CI parity before
  `gh pr create` runs.

**Phase 2 (push + pull):**

- Session start → digest emitter queries DB (last 14d, bug-first) → `additionalContext`
  injected once (local + remote).
- Edit/Write → inject hook → per-domain budget now reserves bug-track slot → recent bug
  surfaces alongside knowledge.
- On demand → `recent_solutions` MCP tool (agent) or `solutions:db:recent` CLI (human) →
  recent list, no embedding.

## Error handling

- **Gate:** infra failures (Postgres down) degrade `vitest related` to a warning; pure
  checks always run; `--no-verify` is the explicit escape.
- **Digest / recent query:** fail-silent on DB-unreachable (no session-start error, empty
  output). The read-only role + single-statement guard already constrain the MCP surface.

## Testing

- **Gate:** unit-test the change-set detection (new-branch vs. existing-branch oid ranges)
  and the fast-vs-full mode selection; a smoke test that a seeded lint/type error makes the
  hook exit non-zero. The existing CI hook-tests (`test-commit-verify` etc.) pattern applies.
- **B1/B2:** extend `test-inject-patterns.sh` + `solutions:db:hook-check` for the bug-track
  reservation; add a digest-output test (≥1 recent bug surfaces, fail-silent on no DB).
- **B3:** unit-test the query/param builder for `recent_solutions` (mirrors the existing
  `query-builder.ts` extraction + test) and a CLI smoke test.

## Rollout / sequencing

1. **Phase 1 first** (stops the emails; smallest, highest-impact). Land the `pre-push` hook +
   `preflight`/`preflight:fast` scripts, the PR-creation gate wiring (`/todo` step + manual
   alias), then the CLAUDE.md reconciliation — in the same change.
2. **Phase 2** after: B3 (recent tool + CLI — self-contained, no hook risk) → B1 (session
   digest) → B2 (inject reservation, the most invasive to the equivalence gates).

## Open risks

- **Fast-gate timing.** tsc + scoped lint + related-tests must stay under the bypass-temptation
  threshold (~75s) on this repo. If tsc alone is too slow, consider incremental/`tsc --build`
  or accepting types-in-`preflight`-only. Measure during implementation.
- **`vitest related` fidelity** with this project's vitest config (mocks, env-dependent
  modules). Verify it resolves the `@/` / `@shared/` aliases; fall back to a changed-dir test
  glob if not.
- **Manual PR opened outside the alias.** The PR-creation gate covers the dominant `/todo`
  flow (it owns `gh pr create`) and any manual PR opened via the `preflight && gh pr create`
  alias. The residual exposure is a hand-made PR opened with a bare `gh pr create` that skips
  the alias — coverage would reach CI for that one PR. Mitigated by documenting the alias;
  not structurally enforceable without wrapping `gh` itself (out of scope).
- **`gh` dependency for mode selection.** PR detection needs an authenticated `gh`. If it's
  missing the hook falls back to `preflight:fast` with a warning (push not blocked) — so a
  misconfigured `gh` silently downgrades the coverage guard. Acceptable; surfaced via the
  warning.
