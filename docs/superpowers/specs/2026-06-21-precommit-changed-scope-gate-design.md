# Changed-scope blocking commit gate: catch lint/type/test errors before commit

**Date:** 2026-06-21
**Status:** Design approved — pending spec review, then `writing-plans`
**Author:** Claude (brainstorming session with William)

## Problem

The user wants type errors, test failures, and type-aware-lint violations caught
**before a commit lands**, not only at the push boundary.

Investigation reframed this from "build validation" to **trigger relocation**. The
validation logic already exists and is battle-tested:

- [`scripts/preflight.sh`](../../../scripts/preflight.sh) `--fast` mode already runs, on the
  branch's changed files: type-aware ESLint (`ESLINT_NO_TYPE_AWARE=`), whole-program
  `check:types` (`tsc --noEmit`), and `vitest related --run`.
- The **2026-06-19 prevention-loop design** wired that gate at the **push** boundary
  (G1: "catch lint/test failures locally before push"). It fires as `preflight:fast`
  when there is no open PR, full `preflight` when there is.

The gap: between an edit and a commit, the only validation is
[`.husky/pre-commit`](../../../.husky/pre-commit) → `lint-staged`, which runs
**non-type-aware** `eslint --fix` + prettier + a few targeted checks. **No `tsc`, no
tests, no type-aware lint.** So a developer can stack several commits on broken
types/tests and not discover it until `git push`.

This design pulls the existing gate **one boundary earlier — to the commit** — scoped to
_staged_ files. It does not replace the push gate (which stays for full coverage and
defense-in-depth); it adds an earlier, cheaper, change-scoped checkpoint.

## Goals

- **G1.** Block a commit that introduces a TypeScript type error, a type-aware-lint
  violation, or a (unit) test failure in the staged change — before the commit is created.
- **G2.** Reuse `preflight.sh`'s exact check commands so commit / push / CI never drift.
- **G3.** Keep commits fast enough that `--no-verify` is not routinely tempting: scope to
  staged files, incremental `tsc`, unit tests only (no DB).

## Non-goals (deferred — YAGNI)

- **Replacing the push gate.** `preflight:fast` / full `preflight` stay exactly as-is.
- **Integration tests at commit.** `server/storage/__tests__/**` (DB-backed) run at push,
  not commit (see "Test scope" decision below).
- **Stash-isolation of partial staging.** v1 validates the working tree, not a pristine
  staged snapshot (see Limitations).
- **Blast-radius capping** of `vitest related`. Log the count; cap later if it bites.
- **A separate Claude PreToolUse(git commit) hook.** Husky `pre-commit` fires for _every_
  commit (Claude, the user, other agents), so the git-hook layer is the single universal
  home. The existing `commit-verify` PostToolUse hook already surfaces a blocked commit
  back to Claude, closing the loop.

## Architecture

One new mode on the existing script, one call from Husky, one npm script. No new
validation logic.

```
git commit
   └─ .husky/pre-commit
        ├─ npx lint-staged --concurrent false      (existing: eslint --fix, prettier, a11y/IDOR…)
        └─ bash scripts/preflight.sh --staged       (NEW: the blocking gate)
                ├─ CHANGED = git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx'
                ├─ type-aware eslint on CHANGED       (reused from --fast)
                ├─ check:types:incremental            (NEW npm script: cached tsc --noEmit)
                └─ vitest related --run CHANGED       (unit-only: excludes server/storage/__tests__)
        exit ≠ 0 ⇒ commit blocked   (bypass: git commit --no-verify, or PRECOMMIT_SKIP_GATE=1)
```

## Components

### a. `scripts/preflight.sh` — add a third mode `--staged`

Mirrors the `--fast` block, with three differences:

1. **Scope source:** `CHANGED` comes from `git diff --cached --name-only --diff-filter=ACMR
-- '*.ts' '*.tsx'` (what is about to be committed), not the `origin/main..HEAD` range.
   The about-to-commit work is not in that range yet, so `--fast`'s scope genuinely would
   not cover it.
2. **Type check:** uses the new `check:types:incremental` (below), not plain
   `check:types`.
3. **Tests:** unit-only — `vitest related --run "${CHANGED[@]}" --exclude
'server/storage/__tests__/**'`. No DB needed, so the `pg_isready` degradation branch
   from `--fast` is omitted entirely. **Implementation must verify** that vitest 4 honors
   `related` + `--exclude` together; fallback if not: post-filter the `related` set, or run
   `test:unit`-style exclusion via a config override.

Runs **after** lint-staged (Husky orders the two calls), so it validates the auto-fixed,
re-staged result. Writes **no** pass-stamp (the HEAD-keyed stamp stays unique to full
`preflight`). Omits the `--fast` extras (`build:copilot-instructions:check`,
`lsp:check-agent-block`) — they are unrelated to the three error classes and still run at
push.

**tsc trigger:** decided by a **separate** staged-file probe, _not_ `CHANGED` (which is
`*.ts`/`*.tsx`-only and drives only eslint + vitest). Run `check:types:incremental`
whenever `git diff --cached --name-only --diff-filter=ACMR` contains any `*.ts`, `*.tsx`,
`*.json`, or `tsconfig*` file — the JSON / tsconfig cases cover `resolveJsonModule` imports
and path-config changes that a `*.ts`-only filter would miss. Skip tsc for pure non-code
commits (e.g. docs-only) so those stay instant.

### b. New npm script `check:types:incremental`

```
"check:types:incremental": "tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc-precommit.tsbuildinfo"
```

A **dedicated** build-info file so it never clobbers any other `tsc` cache. CI and full
`preflight` keep plain `check:types` → **zero CI command drift**. `--incremental` changes
speed, not correctness: the first commit of a session pays the full cost (~10–40s),
repeats are fast (~1–5s). `node_modules/.cache/` is already gitignored.

### c. `.husky/pre-commit`

Append, after the existing `lint-staged` line:

```bash
PRECOMMIT_SKIP_GATE="${PRECOMMIT_SKIP_GATE:-}"
if [ -z "$PRECOMMIT_SKIP_GATE" ]; then
  bash scripts/preflight.sh --staged || exit 1
fi
```

`git commit --no-verify` (Husky standard) and `PRECOMMIT_SKIP_GATE=1` are the escape
hatches.

## Data flow & error surfacing

On failure, the gate prints the offending `tsc` / `eslint` / `vitest` output to stderr;
Husky returns non-zero; `git commit` aborts with that output visible in the terminal and
in Claude's Bash tool result. Because the commit aborts with staged files intact, the
**improved `commit-verify` PostToolUse hook** also tells Claude "commit may have been
silently blocked" — the agent loop closes itself with no extra wiring.

## Test scope decision (the DB-staleness gap)

`vitest related` against a dev DB whose schema does not match the staged change (e.g.
right after a `shared/schema.ts` edit, before `db:push`) produces mass `42703 undefined
column` failures — a documented breakage in this repo. Relocating to the commit boundary
_amplifies_ it (you commit more often than you push, and a schema commit is both the
largest `related` set and the stale-DB case at once). `db:push` in the gate is rejected
(it mutates the shared dev DB on every schema commit — dangerous with parallel agents).

**Decision: unit tests only at commit.** The gate excludes `server/storage/__tests__/**`
(the same line `test:unit` draws). Unit tests need no DB, so the stale-schema false-block
is eliminated structurally, and the gate has no Postgres dependency. Integration tests
remain at the push gate. Trade-off: an integration-only regression is caught at push, not
commit — acceptable, because those tests are DB-backed and slower by nature.

## Known limitations (deliberate, v1)

- **Partial staging:** the gate validates the working tree, not a pristine staged
  snapshot, so unstaged edits to a staged file are included. Matches the common
  stage-all-then-commit flow; full stash-isolation is deferred.
- **Whole-program tsc:** a pre-existing type error _anywhere_ blocks every commit.
  Acceptable because `main` is CI-enforced type-clean; `--no-verify` is the escape hatch.
- **Large blast radius:** editing a widely-imported file makes `vitest related` run many
  unit tests; the gate logs the count. Capping deferred.

## Testing approach (scoped honestly)

- **Hermetic, in a `test-*.sh`-style harness:** the `CHANGED` computation (`git diff
--cached` parsing in a temp repo) and the skip/run branching (no-TS-staged → skip tsc &
  tests; docs-only → fully skip; TS/JSON/tsconfig staged → run). These are cheap and
  high-value.
- **Not hermetically tested:** the actual `tsc` / `vitest related` invocations — they need
  a real tsconfig, `node_modules`, and the test runner, which is integration-level, not a
  unit test. Verified manually during implementation (stage a file with a deliberate type
  error → assert the commit is blocked; fix it → assert the commit succeeds).

## Open questions

All resolved during brainstorming:

- Error classes to catch → **all three** (type, type-aware lint, tests).
- Gate behavior → **blocking, changed-scope**.
- tsc at commit → **incremental, dedicated tsBuildInfo**, triggered on TS/JSON/tsconfig.
- Test scope → **unit-only** (integration deferred to push).
- `--fast` extras → **omitted** at commit.
- Implementation layer → **Husky `pre-commit`** (universal), not a Claude-only hook.

## Rollout

Single, focused change: one script mode + one npm script + one Husky line + a hermetic
test for the branching logic. Low blast radius; `--no-verify` / `PRECOMMIT_SKIP_GATE=1`
provide immediate rollback without code changes if the gate proves too slow in practice.
The existing push gate and CI are untouched, so worst case the new gate is bypassed and
behavior reverts to today's.
