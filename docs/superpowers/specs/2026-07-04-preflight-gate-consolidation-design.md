# Preflight Gate Consolidation — Design

**Date:** 2026-07-04
**Status:** Approved (design); pending implementation plan
**Target files (tracked — change goes through CI on its own branch):**
`.husky/pre-commit`, `.husky/pre-push`, `scripts/preflight.sh`,
`.claude/hooks/pr-preflight-guard.sh`, and the affected `.claude/hooks/test-*.sh`.
**Also updated (local-only):** `CLAUDE.md` (gitignored) and two auto-memory files.
**This spec:** local-only (`docs/superpowers/specs/` is gitignored, like all existing specs).

## Goal

Cut the token/time cost of the local quality gates — which currently fire the
CI-identical suite **redundantly**, sometimes twice on the same commit — **without**
weakening the protection of `main` (which is, and remains, CI + branch protection —
never the local gates).

Concretely: **one semantic local gate, at push, run once per HEAD, quiet on success.**

## Problem (verified against the source, not assumed)

Four local gates drive three preflight modes today:

| #   | Trigger                                         | Runs                                                                                                                                 | Weight          |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| 1   | pre-commit (every commit)                       | lint-staged **+** `preflight.sh --staged` (type-aware ESLint + incremental `tsc` + `vitest related`)                                 | per-commit      |
| 2   | pre-push, **no** open PR                        | `preflight.sh --fast` (copilot-check + ESLint(changed) + full `tsc` + related tests)                                                 | per-push        |
| 3   | pre-push, **open** PR                           | full `npm run preflight` (lint + suppress + tsc + 4 pattern checks + hook self-tests + `db:push` + **coverage**) → writes HEAD stamp | per-push, heavy |
| 4   | before `gh pr create` / MCP create_pull_request | guard hook: **deny** unless a **full** stamp matches HEAD                                                                            | —               |

Two distinct redundancies compound:

1. **Local ↔ local double-run.** `scripts/preflight.sh` full mode _writes_ a HEAD-keyed
   pass-stamp but **never reads one**; gate #3 (`pre-push`) also never reads it. So the
   canonical Claude sequence — run `npm run preflight` manually (CLAUDE.md instructs it
   before a PR), then `git push` to an open PR — runs the **entire full suite twice on
   the identical HEAD**, back-to-back, output in context both times.
2. **Local ↔ remote double-run.** Gate #3 runs the full coverage suite + `db:push`
   locally on every PR-updating push, and GitHub CI then runs the identical suite
   remotely. Coverage is paid for twice per push.

Separately, the **per-commit** gate (#1) is the "runs all the time" weight: every
commit fires **two** ESLint passes on staged files — lint-staged's
`ESLINT_NO_TYPE_AWARE=1 eslint --fix` and the gate's `ESLINT_NO_TYPE_AWARE= eslint`
type-aware pass — **plus** incremental `tsc` **plus** `vitest related`. And gate #2
(`--fast`) is a near-superset of gate #1 (full `tsc` ⊇ incremental; branch-vs-main
range ⊇ staged files), so committing then immediately pushing does that work twice.

Finally, on the happy path every gate dumps `tsc`/`eslint`/`vitest` output straight
into Claude's context — the literal "token heavy … run all the time" complaint —
even when it passes and the detail is never needed.

## Decisions (resolved during brainstorming)

| Decision                               | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Division of labor (local vs CI)        | **Hybrid on "A"**: local runs a fast smoke gate; the heavy coverage + full suite are **delegated to CI** (the source of truth). `main` safety is unchanged — CI + branch protection always protected it, never the local gates. **Verified (live, 2026-07-04):** `Coverage thresholds` is one of the 8 **required** status checks on `main` with `enforce_admins:true`, so a coverage failure yields `mergeStateStatus: BLOCKED` for everyone. Delegating coverage to CI is therefore a _timing_ shift (fails at CI, not locally), **not** a protection regression — no new "make coverage required" task is needed. |
| Semantic-gate scheduling               | **One gate, at push.** The per-commit `--staged` semantic gate is **removed**; commits keep only lint-staged (fix/format + cheap pattern checks). Type-aware lint + `tsc` + related tests run **once, at pre-push**.                                                                                                                                                                                                                                                                                                                                                                                                 |
| The pre-push full escalation (gate #3) | **Deleted.** Pre-push always runs the fast smoke gate. Full CI parity is **on-demand only** via `npm run preflight`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Stamp semantics                        | The HEAD-keyed pass-stamp becomes the **single "this HEAD is verified" token**, written by both fast and full, read by pre-push (skip) and the PR-guard (allow). Bare SHA — no fast/full tag.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PR-create guard (gate #4)              | **Relaxed** to allow on **any** HEAD-matching stamp (fast or full). Kept as cheap insurance against opening a PR from a HEAD that never passed even the fast checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Output verbosity                       | **Quiet-on-success** in `scripts/preflight.sh` for all modes (incl. on-demand full): one summary line per step on pass; full buffered output only on failure.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Design

### 1. Gate topology (after)

| Moment                                  | Behavior                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Commit** (`.husky/pre-commit`)        | lint-staged only — `eslint --fix`, `prettier --write`, and the cheap per-glob pattern checks it already runs (a11y + colors on `client/**/*.tsx`, IDOR on `server/storage/*.ts`, jsdom on test files, solution-frontmatter / rules-size / eval-dataset-secrets on their doc globs). No semantic gate.                                       |
| **Push** (`.husky/pre-push`)            | (a) the existing delete/no-op ref-skip runs **first** (all-zero local sha / provably-empty commit range → exit, never consults the stamp); (b) else if a stamp matches HEAD → **skip** (already verified); (c) else run `preflight.sh --fast`, which verifies and conditionally **writes the stamp**. No `gh` PR detection, no MODE branch. |
| **PR create** (`pr-preflight-guard.sh`) | Allow if a stamp matches HEAD (fast **or** full); else deny (bypass `SKIP_PR_PREFLIGHT=1`).                                                                                                                                                                                                                                                 |
| **On demand** (`npm run preflight`)     | Unchanged scope (full CI parity incl. coverage); still writes the stamp; now quiet-on-success.                                                                                                                                                                                                                                              |
| **CI** (`.github/workflows/ci.yml`)     | Unchanged — the source of truth for the full suite + coverage.                                                                                                                                                                                                                                                                              |

### 2. Stamp as the unified "verified" token

The pass-stamp is keyed to the commit SHA (`scripts/lib/preflight-stamp-path.sh`,
**unchanged**). Promotion to single source of truth:

- **`--fast` writes the stamp on success — but only when its checks actually ran.**
  A stamp must certify _executed_ verification, not skipped verification. So if the
  related-tests step was **skipped because Postgres was unreachable**, `--fast` does
  **not** write the stamp: it warns loudly and exits 0 (the push still succeeds — WIP
  isn't blocked), leaving HEAD unstamped so the PR-guard blocks PR creation until a real
  run happens (or `SKIP_PR_PREFLIGHT=1`). A push whose diff has **no** changed
  `.ts/.tsx` needs no related tests → still eligible to stamp. Precise rule:
  _stamp unless (changed TS files exist AND Postgres unreachable AND tests were thus
  skipped)._ Today only full mode stamps; fast gains this conditional stamp.
- **Pre-push:** delete/no-op ref-skip **first** (never consults the stamp); then
  `if stamp == HEAD → skip; else run --fast (which conditionally stamps HEAD)`.
- **PR-guard:** `if stamp == HEAD → allow; else deny`.

Correctness: a stamp can only exist for the exact commit that produced it, so
skip-if-stamped never skips un-verified code; an amend/new commit yields a new SHA,
the stamp misses, and the gate re-runs. Stamp stays a **bare SHA** — both modes write
identical content; we deliberately do **not** tag fast vs full (not needed under this
philosophy — see YAGNI).

### 3. Quiet-on-success

`scripts/preflight.sh`'s `run()` wrapper changes from "echo `▶ cmd` then stream all
output" to buffering:

- **Breadcrumb:** print `▶ <step>…` **before** each step so a human on the
  minutes-long full run sees live progress and never mistakes buffering for a hang.
- **Pass:** replace/append one line — e.g. `✔ npm run check:types` — discard output.
- **Fail:** print `✗ <cmd>` + the full buffered combined output, then propagate the
  non-zero exit.
- **`PREFLIGHT_VERBOSE=1` escape hatch** (baked in, not an afterthought): stream every
  step's output live, exactly like today. For when a human wants the full firehose.
- **`db:push` is exempt — invoked outside the buffering wrapper (streamed).**
  `db:push` is `drizzle-kit push`, which can prompt interactively on a destructive
  diff; buffering would hide the prompt and turn it into an invisible hang. It runs
  **only** in on-demand full mode (never on the fast push hot-path), so streaming it
  costs nothing on the token-sensitive path.
- The script's own signal lines (Postgres-unreachable warning, the final
  `✅ … passed`, drift notices) always print — they are not suppressed command output.
- `PREFLIGHT_DRY_RUN=1` behavior (used by the gate self-tests) is preserved: it still
  echoes the command and returns 0 without executing.

Applies to **all** modes, so invoking the on-demand full preflight is no longer a
token bomb in Claude's context.

### 4. File-by-file change surface

- **`.husky/pre-commit`** — remove the `--staged` gate invocation block (and its
  `grep -q -- '--staged'` guard); keep the lint-staged run and the bash re-exec header.
- **`.husky/pre-push`** — delete the `gh pr list` detection and the fast/full MODE
  branch; keep the delete/no-op ref-scan skip and run it **first**; then the stamp-skip
  check; else always invoke `preflight.sh --fast`.
- **`scripts/preflight.sh`** — remove the `--staged` MODE block; make `--fast` write
  the stamp **conditionally** (not when related tests were skipped for an unreachable
  Postgres); rewrite `run()` for quiet-on-success with a `▶ <step>…` breadcrumb and a
  `PREFLIGHT_VERBOSE=1` streaming escape; invoke `db:push` outside the wrapper
  (streamed). Full mode inherits all of this.
- **`.claude/hooks/pr-preflight-guard.sh`** — accept any HEAD-matching stamp; update
  the deny reason to reflect that a push runs the fast gate which stamps HEAD (or run
  `npm run preflight`); coverage is CI's job.
- **`scripts/lib/preflight-stamp-path.sh`** — **unchanged** (same path, same format).

### 5. Test surface (TDD — tests change first)

Run via `scripts/run-hook-tests.sh` (already CI-wired; the hook self-tests are also
part of the on-demand full preflight).

- **`.claude/hooks/test-pre-push.sh`** — currently asserts the open-PR→full escalation
  (deleted behavior). Rewrite to assert: always-fast, delete/no-op skip runs before any
  stamp read, stamp-skip when HEAD is stamped, stamp written after a fast pass that ran
  its tests, and — critically — **no stamp written when related tests were skipped
  because Postgres was unreachable** (so the guard still blocks).
- **`.claude/hooks/test-pr-preflight-guard.sh`** — rewrite: allow on a fast-or-full
  HEAD-matching stamp; deny on missing/stale stamp; `SKIP_PR_PREFLIGHT` bypass intact.
- **`.claude/hooks/test-precommit-gate.sh`** — rewrite or retire: pre-commit no longer
  runs the semantic gate (asserts only lint-staged fires).
- **New test** — assert quiet-on-success at the **script level** (no internal-function
  seam): invoke the real `preflight.sh --fast` with a step forced to pass, and again
  with a step forced to fail (e.g. a stub shadowed onto `PATH`, or a dedicated
  `PREFLIGHT_SELFTEST_CMD`), then assert stdout contains the one-line `✔` summary on
  pass and the full failing-command output only on fail.
- **`.claude/hooks/test-preflight-stamp-path.sh`** — unchanged (path/format untouched).

### 6. Docs / memory updates (or the next session fights stale instructions)

- **`CLAUDE.md`** (gitignored/local-only): rewrite the two stale claims — "PR creation
  is hard-blocked until `npm run preflight` (full CI parity incl. coverage) passes" and
  "pre-push runs `preflight:fast` on WIP / full `preflight` on PR-branch pushes" — to
  the new model: commit = lint-staged only; push = one fast gate + stamp-skip; PR-guard
  accepts a fast stamp; coverage is delegated to CI; full preflight is on-demand.
- **Auto-memory:** update `project_precommit_changed_scope_gate.md` and the PR-guard
  note to the new topology.

## Risks explicitly accepted (philosophy "A")

- A coverage-threshold or full-suite-only failure now surfaces in **CI (~2–4 min)**,
  not locally. This is a _timing_ shift, not a protection gap: `Coverage thresholds`
  is a **required, blocking** check on `main` (verified live — see Decisions), so such
  a failure was never mergeable and still isn't. TDD + the related-tests gate catch
  most of it before CI; pulling CI failed-step logs is far cheaper than running
  coverage in Claude's context.
- A **`--fast` stamp means "lint + types + related-tests passed" — not coverage.**
  Coverage is CI's job (above). The stamp does **not** over-certify: per the stamp
  rule, `--fast` refuses to stamp when related tests were skipped (Postgres down), so
  a "verified" stamp never stands in for tests that didn't run — a green stamp over
  zero executed tests is the exact silent-green failure mode this repo keeps codifying
  against, and the design closes it.
- Semantic breaks (type/test) are caught at **push**, not commit. Accepted — this repo
  pushes per change, so commit→push latency is short.

## Out of scope (YAGNI)

- Tagging the stamp with its level (fast vs full) or per-branch "require full" policies.
- Making CI itself faster.
- Changing what CI runs, or the coverage thresholds.

## Implementation notes

- `core.hooksPath` = `<main-checkout>/.husky/_` (husky v9 wrappers). The hook _files_
  (`.husky/pre-commit`, `.husky/pre-push`) are shared across worktrees but each resolves
  `scripts/preflight.sh` relative to its own cwd — so the behavior change lands via the
  main checkout's `.husky/` files and takes effect for all worktrees. Verify hook
  resolution when testing the change end-to-end (commit + push in a scratch clone or via
  the `PREFLIGHT_DRY_RUN` self-tests rather than a real push).
- No new npm scripts. `preflight` / `preflight:fast` stay; `preflight:staged` never
  existed as a script (only the mode), so removing the mode needs no package.json edit.
