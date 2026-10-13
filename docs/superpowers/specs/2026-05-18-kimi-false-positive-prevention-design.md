# Kimi False-Positive Prevention — Design

**Date:** 2026-05-18
**Status:** Approved for planning
**Author:** brainstorming session

## Problem

The `kimi-review` code-review gate (DeepSeek V4 Flash via OpenRouter, branded
"Kimi") repeatedly produces false-positive CRITICAL findings. These block
commits, put red Xs on PRs, and force `SKIP_KIMI_REVIEW=1` workarounds. The
project has accumulated documented post-mortems of false CRITICALs; this design
addresses their root causes.

The gate runs on three surfaces, all sharing one review engine:

- **Claude-Code PreToolUse hook** — `.claude/hooks/kimi-review.sh`
- **Husky pre-commit** — `.husky/pre-commit`
- **CI "Kimi Review" job** — `scripts/ci-kimi-review.sh`

The engine itself is duplicated by design:

- `~/.local/bin/kimi-review` — local developer CLI (unversioned bespoke script)
- `scripts/kimi-review.py` — in-repo CI variant, hand-synced with the above

## Root Causes

Four distinct mechanisms produce false positives — not one bug:

1. **Diff-window starvation.** The wrappers generate the review diff with
   `git diff … -- '*.ts' '*.tsx'` at the default ~3 lines of context. Code that
   satisfies a convention frequently sits just outside the hunk window. Example
   (PR #206): a "comment/index mismatch" CRITICAL where the correct index line
   sat 4 lines outside the context window.

2. **Change-set blindness.** The wrappers deliberately send only `.ts`/`.tsx`
   files to the external reviewer, so accidental secret-bearing files
   (`.env`, config) are never transmitted. Side effect: the reviewer cannot see
   staged `.sql` migrations, JSON, or config, and false-flags them as missing.
   Example (PR #206, PR #227): "no UTC timezone pin" / "no migration script
   staged" CRITICALs where the migration _was_ staged in the same commit.

3. **Non-determinism.** `kimi-review` calls the model with no `temperature`
   set, so it defaults to ~1.0. The same diff yields a CRITICAL on one run and
   a clean pass on a re-run (PR #229).

4. **Stale-branch symmetric diff.** The manual `kimi-review --base main` path
   builds the ref as `{base}..HEAD`, which is endpoint-to-endpoint. On a branch
   behind `main`, commits `main` added but the branch lacks appear as fake
   "deletions" (IDOR removed, CHECK constraint removed, etc. — PR #128). The CI
   path is unaffected: `ci-kimi-review.sh` already diffs from the merge base.

The common thread for (1) and (2): the reviewer is asked to be a hard quality
gate but given a keyhole view, so it hallucinates absences. It has the project
rulebook (`docs/rules/*` + `docs/legacy-patterns/*` are already passed via
`--patterns`/`--rules`); it lacks the evidence to confirm the rules are met.

## Goals

- Eliminate the documented false-positive classes (1)–(4).
- Preserve the secret-safety invariant: no `.env`/config/secret content is ever
  transmitted to the external reviewer.
- Preserve the CI `pull_request_target` security invariant: never checkout,
  source, import, install from, or execute PR-head files while secrets are in
  scope (reading diff/name data is fine).
- Keep changes surgical — no engine consolidation, no second LLM pass.

## Non-Goals

- **Engine consolidation.** The two engine copies stay separate and
  hand-synced; identical changes are applied to both. (Explicitly chosen.)
- **Confirmation / second-pass review.** No second LLM call. (Explicitly
  chosen — keeps the latency-sensitive pre-commit gate fast.)
- CLAUDE.md workaround-guidance edits, and the path→domain pattern mapping.

## Approach

Approach A — wider diff context + a names-only change-set manifest + tuning.
One LLM call, no full-file reads, secret-safe.

### 1. Wider diff context (`--function-context`)

Every place the review diff is generated, add `--function-context` so each hunk
expands to its enclosing function/declaration:

- Wrappers: `.claude/hooks/kimi-review.sh`, `.husky/pre-commit`,
  `scripts/ci-kimi-review.sh` — the `git diff … -- '*.ts' '*.tsx'` that builds
  the piped review diff.
- Engine fallback: `~/.local/bin/kimi-review` and `scripts/kimi-review.py` —
  the `git diff <ref>` used when no diff is piped on stdin.

Fixes class (1). Function detection is heuristic and may not fully expand a
top-level `pgTable(...)` const; the manifest + prompt hardening below backstop
that residual case.

### 2. Change-set manifest (`--changed-files`)

Give each wrapper a dedicated `git diff --name-status` capture of the full
change-set and pass it to the engine via a new `--changed-files` argument. Use a
separate capture rather than reusing the existing pattern-mapping input:

- The hook (`.claude/hooks/kimi-review.sh`) filters its file list to
  `.ts`/`.tsx` _before_ the pattern loop, so it has no full list today — a new
  capture is required regardless.
- CI (`ci-kimi-review.sh`) and Husky (`pre-commit`) do compute an all-files
  name-only list, but it feeds `case "$file"` path matching; switching it to
  `--name-status` would prepend an `M `/`A ` status and break those matches.

A dedicated capture leaves all pattern-loop inputs untouched.

The engine renders it as a `<changed-files>` block in the user message,
listing **every** file in the change-set with its git status — **names only,
no content**:

```
<changed-files>
M  shared/schema.ts
A  migrations/0043_add_meal_xor.sql
M  server/storage/meals.ts
</changed-files>
```

Names-only keeps the secret-safety invariant intact: a filename leaks nothing.
The `.ts`/`.tsx` files also appear in `<diff>`; the others (`.sql`, config,
JSON, docs) appear only here, which is enough to establish their existence.

Fixes class (2).

### 3. System-prompt hardening

Add a paragraph to the system prompt in both engine copies:

> You see a partial view: a unified diff with function-level context, not
> necessarily whole files. A `<changed-files>` block lists EVERY file in this
> change-set. Files not shown in `<diff>` (e.g. `.sql` migrations, config,
> JSON) were still changed — their existence is established. NEVER raise a
> finding claiming a file, migration, test, index, or guard is missing when it
> appears in `<changed-files>`. If a risk depends on code you cannot see, raise
> it only as WARNING and state explicitly what must be verified.

This converts hallucinated-absence CRITICALs into either nothing or a
non-blocking WARNING with an explicit "verify this" note. The input-format
sentence ("a unified git diff inside `<diff>`, optionally followed by `<file>`
blocks") is extended to mention the `<changed-files>` block.

### 4. Determinism (`temperature=0`)

Add `temperature=0` to the `client.chat.completions.create(...)` call in both
engine copies. Collapses most verdict-flipping (class 3).

**Risk:** DeepSeek V4 Flash runs with reasoning on. OpenRouter is expected to
accept `temperature` for final-token sampling, but the implementation must make
one real `temperature=0` call to confirm it does not return a 400. If it does,
drop the parameter and document why in the spec/code comment. No runtime
fallback branching.

### 5. Three-dot diff for the manual `--base` path

In both engine copies, change the ref construction from `{base}..HEAD` to
`{base}...HEAD` so the diff runs from the merge base to HEAD. Fixes class (4).
The `HEAD~1` fallback (no `--base`) is unchanged.

### 6. Architecture reference doc

The Kimi review system has grown to two engine copies, three wrapper surfaces,
two test files, model/profile/pattern config, and non-obvious invariants
(secret-safety, CI `pull_request_target` rules, skip semantics, the
unversioned-script gap). There is no single document explaining how it fits
together. Add one: `docs/kimi-review-architecture.md`, the single source of
truth, covering:

- **Surfaces** — the three entry points (Claude-Code PreToolUse hook, Husky
  pre-commit, CI job), what triggers each, and which blocks vs. warns.
- **Engine** — the two copies (`~/.local/bin/kimi-review`,
  `scripts/kimi-review.py`), why they are duplicated, and the hand-sync
  obligation. The unversioned-local-script gap is called out explicitly.
- **Data flow** — how a diff, the `<changed-files>` manifest, patterns/rules,
  and the profile become one LLM call; the `--function-context` and three-dot
  diff behavior.
- **Config** — model, `WORKER_*` / `OPENROUTER_*` env vars, profiles, the
  path→domain pattern mapping, `temperature=0`.
- **Invariants** — the secret-safety exclusion of non-`.ts`/`.tsx` content, the
  CI security invariant, `SKIP_KIMI_REVIEW` semantics and how the inline-prefix
  vs. process-env distinction affects each surface.
- **False-positive design** — a short section summarizing the four mechanisms
  and the fixes from this spec, so the rationale survives.

The doc reflects the system **after** this change. It is written last, once the
code changes are settled, so it documents the real end state.

## Files Changed

| File                                | Change                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.local/bin/kimi-review`          | `--changed-files` arg + `<changed-files>` render; `temperature=0`; prompt hardening; `..`→`...`; `--function-context` on fallback `git diff`                                               |
| `scripts/kimi-review.py`            | Identical changes (hand-synced)                                                                                                                                                            |
| `.claude/hooks/kimi-review.sh`      | `--function-context` on review diff; new dedicated `--name-status` capture; pass `--changed-files`                                                                                         |
| `.husky/pre-commit`                 | Same wrapper changes                                                                                                                                                                       |
| `scripts/ci-kimi-review.sh`         | Same wrapper changes                                                                                                                                                                       |
| `.claude/hooks/test-kimi-review.sh` | In-repo harness. New bash cases: wrappers pass `--changed-files`; new embedded Python cases for `scripts/kimi-review.py` `render_changed_files`/`build_diff_ref`; existing cases unchanged |
| `~/.local/bin/test-kimi-review.py`  | Unversioned. New cases for the local engine's `render_changed_files`/`build_diff_ref`; existing `filter_review` cases unchanged                                                            |
| `docs/kimi-review-architecture.md`  | New — full architecture reference for the Kimi review system (see §6); written last                                                                                                        |

`~/.local/bin/kimi-review` is unversioned — it has no source-of-truth repo.
The implementation must edit it in place and note in the final report that the
local copy was changed outside the repo.

## Verification

1. **First, before any code change:** one real `temperature=0` call against
   OpenRouter to confirm DeepSeek V4 Flash accepts it (no 400). This gates §4 —
   if rejected, drop `temperature` and soften §4's wording (see Risk under §4).
2. Run both test suites: `.claude/hooks/test-kimi-review.sh` and
   `python3 ~/.local/bin/test-kimi-review.py` — all pass.
3. Smoke test for class (2): a synthetic change-set touching `shared/schema.ts`
   with a `migrations/*.sql` file present in `--changed-files`; confirm Kimi no
   longer emits a "no migration" CRITICAL.
4. Smoke test for class (1): a diff whose relevant context (e.g. a matching
   index line) sits >3 lines from the change; confirm `--function-context`
   includes it.
5. Read `docs/kimi-review-architecture.md` against the final code — every
   file path, env var, and invariant it cites matches the shipped state.

## Open Risks

- `temperature` rejection by the reasoning model — mitigated by verification
  step 2.
- `--function-context` under-expanding top-level schema consts — mitigated by
  the manifest + prompt hardening.
- Larger prompt — negligible cost (DeepSeek V4 Flash is cheap, 1M context).
