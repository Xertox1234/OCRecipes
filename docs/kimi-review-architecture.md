# Kimi Review System — Architecture Reference

**Last updated:** 2026-05-20
**Design spec:** [docs/superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md](superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md)

This document is the single source of truth for the Kimi code-review gate:
how it runs, how it blocks, how to configure it, and what invariants must hold.
All file paths are repository-relative unless otherwise stated.

---

## 1. Overview

The gate sends a staged or PR TypeScript diff to DeepSeek V4 Flash (via OpenRouter,
branded "Kimi") and classifies the response into CRITICAL, WARNING, and SUGGESTION
findings. CRITICAL findings that match the mandated finding shape block the action
(commit or PR merge). WARNING and SUGGESTION findings are surfaced but do not block.

Only `.ts` and `.tsx` file content is sent to the external reviewer. All other
file types (migrations, config, env files) are excluded from the diff — they appear
only as names in a `<changed-files>` manifest. This preserves the secret-safety
invariant while still letting the reviewer know those files exist.

---

## 2. Surfaces

Three entry points share one review engine. Each triggers at a different point in
the development cycle.

| Surface                     | File                           | Trigger                                                     | Diff sent                                                                   | Blocks how                                                              | Skip                                                                                                                         |
| --------------------------- | ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Claude-Code PreToolUse hook | `.claude/hooks/kimi-review.sh` | Any `git commit` command issued via Claude Code's Bash tool | `git diff --cached --function-context` on staged `.ts`/`.tsx`               | Returns `permissionDecision: deny` JSON; Claude Code refuses the commit | `SKIP_KIMI_REVIEW=1` in Claude Code's process env; `kimi-review` not on PATH; `jq` not on PATH; no staged `.ts`/`.tsx` files |
| Husky pre-commit            | `.husky/pre-commit`            | Every `git commit` in a terminal (runs after `lint-staged`) | `git diff --cached --function-context` on staged `.ts`/`.tsx`               | Exits 1; git aborts the commit                                          | `SKIP_KIMI_REVIEW=1` in shell env; `kimi-review` not on PATH; no staged `.ts`/`.tsx` files                                   |
| CI "Kimi Review" job        | `scripts/ci-kimi-review.sh`    | GitHub Actions on every PR (via `pull_request_target`)      | `git diff --function-context` from merge-base to PR head, `.ts`/`.tsx` only | Exits 1; job fails                                                      | No `.ts`/`.tsx` diff (job exits 0 early); `WORKER_API_KEY`/`OPENROUTER_API_KEY` absent (job errors before review)            |

### SKIP_KIMI_REVIEW semantics per surface

The environment variable `SKIP_KIMI_REVIEW=1` skips the gate, but how it reaches
each surface differs:

- **Husky** — `SKIP_KIMI_REVIEW=1 git commit ...` works. The inline prefix sets the
  variable in the shell; git's child processes (including Husky) inherit it.
- **Claude-Code hook** — an inline prefix to the Bash command (`SKIP_KIMI_REVIEW=1
git commit ...`) does NOT reach the hook. The hook is a PreToolUse hook in
  Claude Code's own process, which reads its env at startup. An inline prefix
  on the piped command never sets it there. Set the variable in the shell
  running Claude Code instead, or ask the user to run the commit in their terminal.
- **CI** — the CI script has no `SKIP_KIMI_REVIEW` path. CI skips early when
  there is no TypeScript diff. If a real diff needs to skip review, remove
  the CI workflow step or use the `KIMI_REVIEW_TIMEOUT_SECONDS=1` env to
  force a timeout-skip.

---

## 3. Engine

### Two copies, one logic

The review engine is Python. It exists in two copies that are kept in sync by hand:

| Copy      | Path                       | In git?          | Used by                                                                            |
| --------- | -------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| Local CLI | `~/.local/bin/kimi-review` | No — unversioned | Claude-Code hook, Husky                                                            |
| CI copy   | `scripts/kimi-review.py`   | Yes              | GitHub Actions CI job; also used by Husky/hook if `kimi-review` CLI is not on PATH |

The CI script discovers the engine in this order (see `scripts/ci-kimi-review.sh`
lines 65-72): `kimi-review` on PATH first, then `scripts/kimi-review.py`. In
practice on CI the local CLI is absent, so `scripts/kimi-review.py` runs.

### The unversioned-script gap

**This is a real maintenance hazard.**

`~/.local/bin/kimi-review` has no source-of-truth repository. When review logic
changes — prompt wording, a new CLI argument, a helper function — both files must
be updated. The in-repo `scripts/kimi-review.py` gets committed and reviewed; the
local copy is edited in place and is invisible to git.

If the two copies drift, local commits may pass or fail under different rules than
CI. After any logic change, confirm both are in sync before calling the gate
fixed.

### Divergence between the copies (current known delta)

The copies implement the same review logic but differ in two places:

1. **Credential resolution.** `scripts/kimi-review.py` has a dedicated
   `resolve_client_config(env)` function (line 177) that supports all three
   credential providers including `MOONSHOT_API_KEY + WORKER_BASE_URL`. The local
   `~/.local/bin/kimi-review` uses inline `os.environ.get()` calls (line 288) and
   supports only `WORKER_API_KEY` and `OPENROUTER_API_KEY`. The `MOONSHOT_API_KEY`
   fallback is a CI-only feature.

2. **Project profiles.** The local copy supports an additional `plant_id` profile
   (for a different project). `scripts/kimi-review.py` supports only `generic` and
   `ocrecipes`.

3. **System prompt wording.** The local copy has a more detailed system prompt with
   numbered review priorities and constraint bullets. The in-repo copy has a shorter
   prompt. The core hardening paragraphs (changed-files manifest, never-flag-absent
   rule, raise-as-WARNING fallback) are present in both.

4. **Truncation detection.** `scripts/kimi-review.py` checks
   `finish_reason == "length"` (line 324) and exits 1 when the response was
   truncated before printing findings. The local `~/.local/bin/kimi-review` only
   checks `if answer:` (line 361) — a `length`-truncated response with partial
   content passes to `filter_review` and prints potentially incomplete findings.
   This is a CI-only safety feature and a pre-existing divergence (not introduced
   by the false-positive work).

### Testable seams

The engine exposes four pure functions that tests can import and call without a
network or API key:

| Function                                 | File                          | What it does                                                                                                                 |
| ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `filter_review(answer, requested_tiers)` | both copies                   | Drops empty-tier placeholders; keeps findings that match a file reference regex; returns clean message when nothing survives |
| `render_changed_files(changed_files)`    | both copies                   | Wraps `git diff --name-status` text in a `<changed-files>` XML block; returns `""` for empty/None input                      |
| `build_diff_ref(base)`                   | both copies                   | Returns `"{base}...HEAD"` (three-dot merge-base) when base is given; `"HEAD~1"` otherwise                                    |
| `resolve_client_config(env)`             | `scripts/kimi-review.py` only | Resolves API key + base URL from env; validates `MOONSHOT_API_KEY` requires `WORKER_BASE_URL`                                |

---

## 4. Data flow

### What goes into one LLM call

```
user message:
  [Focus: <scope>\n\n]
  <diff>
    git diff --function-context ... -- '*.ts' '*.tsx'
  </diff>
  [<changed-files>
    M  shared/schema.ts
    A  migrations/0043_add_meal_xor.sql
    ...
  </changed-files>]
  [<file path='docs/legacy-patterns/api.md'>...</file> ...]  ← --patterns files
  [<file path='docs/rules/security.md'>...</file> ...]       ← --rules files
```

The diff uses `--function-context`, which expands each hunk to its enclosing
function or declaration (wider than the default 3-line context). This reduces
false positives where the relevant context sat just outside the hunk window.

The `<changed-files>` block lists every file in the change-set with its git status
(`M`/`A`/`D`/`R`/`C`), names only — no content. It is produced by a dedicated
`git diff --name-status` capture in each wrapper, separate from the pattern-loop
file list, so adding it did not disturb the pattern-selection logic.

The system prompt contains hardening that references this block:

> NEVER raise a finding claiming a file, migration, test, index, or guard is missing
> when it appears in `<changed-files>`. If a risk depends on code you cannot see,
> raise it only as WARNING and state explicitly what must be verified.

### Pattern and rules loading

Patterns (`--patterns`) are loaded from `docs/legacy-patterns/<name>.md` (with a
`docs/patterns/` fallback for portability). Each is truncated at `--pattern-max-chars`
(default 12000) unless `--pattern-max-chars 0` is passed. Rules (`--rules`) are
loaded from `docs/rules/<name>.md` without truncation; missing files are silently
skipped.

The path-to-domain mapping — which staged files trigger which pattern names — is
the `case "$file" in` block repeated identically in:

- `.claude/hooks/kimi-review.sh` (lines 52-88)
- `.husky/pre-commit` (lines 42-78)
- `scripts/ci-kimi-review.sh` (lines 82-118)

The mapping is authoritative in those three files. Do not maintain a separate
copy; update all three when domains change.

### Three-dot ref for manual `--base` runs

When the engine generates its own diff (no stdin piped), it uses `build_diff_ref`:

```python
# scripts/kimi-review.py, line 249
return f"{base}...HEAD" if base else "HEAD~1"
```

The three-dot form (`base...HEAD`) diffs from the merge base of `base` and `HEAD`
to `HEAD`, not from `base` to `HEAD` endpoint-to-endpoint. This prevents stale-branch
noise: on a branch behind `main`, the two-dot form surfaces commits `main` added as
fake "deletions".

The CI wrapper computes the merge base explicitly with `git merge-base` and never
uses the engine's `build_diff_ref` (the diff is piped on stdin).

---

## 5. Config

### Model and base URL

| Variable          | Default                        | Description                    |
| ----------------- | ------------------------------ | ------------------------------ |
| `WORKER_MODEL`    | `deepseek/deepseek-v4-flash`   | Model ID passed to the API     |
| `WORKER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible API endpoint |

The default model is DeepSeek V4 Flash served by OpenRouter, branded "Kimi" by
convention in this project. The `WORKER_MODEL` env var overrides the model at
runtime for both engine copies.

### Credential precedence

**`scripts/kimi-review.py` (CI copy, `resolve_client_config`):**

1. `WORKER_API_KEY` — primary; takes any provider
2. `OPENROUTER_API_KEY` — fallback when `WORKER_API_KEY` is unset or empty
3. `MOONSHOT_API_KEY` + `WORKER_BASE_URL` — custom-provider fallback; exits with
   an error if `MOONSHOT_API_KEY` is set without `WORKER_BASE_URL`
4. Missing credentials — exits 1 with an actionable message

**`~/.local/bin/kimi-review` (local CLI):**

Inline lookup; only `WORKER_API_KEY` and `OPENROUTER_API_KEY` are checked. No
`MOONSHOT_API_KEY` support in the local copy.

### Review flags

| Flag                  | Default                       | Description                                                                            |
| --------------------- | ----------------------------- | -------------------------------------------------------------------------------------- |
| `--tiers`             | `CRITICAL,WARNING,SUGGESTION` | Comma-separated tiers to request and return; wrappers pass `CRITICAL,WARNING`          |
| `--profile`           | `auto`                        | Project review profile; `auto` detects OCRecipes by repo name or `CLAUDE.md` content   |
| `--patterns`          | (none)                        | Comma-separated `docs/patterns` names or paths; auto-selected by wrapper path mapping  |
| `--rules`             | (none)                        | Comma-separated `docs/rules` names; wrappers pass same value as `--patterns`           |
| `--pattern-max-chars` | `12000`                       | Per-pattern truncation; `0` = full file                                                |
| `--scope`             | (none)                        | One-line context injected before the diff                                              |
| `--changed-files`     | (none)                        | Newline-delimited `git diff --name-status` output; rendered as `<changed-files>` block |
| `--base`              | (none)                        | Branch/SHA for engine's own diff; uses three-dot merge-base ref                        |

### Temperature

Both engine copies call the model with `temperature=0` (see `scripts/kimi-review.py`
line 317, `~/.local/bin/kimi-review` line 355). This collapses verdict-flipping
where the same diff yielded a CRITICAL on one run and a clean pass on re-run.
Confirmed accepted by DeepSeek V4 Flash via OpenRouter (no 400).

---

## 6. Invariants

### Secret-safety

Only `.ts` and `.tsx` file content enters the `<diff>` block. Non-code files
(`.env`, config, migrations, JSON, docs) are excluded from the diff entirely.
They appear only as filenames in `<changed-files>`. A filename leaks nothing.

This is enforced in every wrapper at the `git diff ... -- '*.ts' '*.tsx'` step.
The pattern-mapping loop operates on the full staged file list (names only), but
only the TypeScript-filtered diff is piped to the engine.

### CI `pull_request_target` security invariant

`scripts/ci-kimi-review.sh` runs in a `pull_request_target` workflow where
repository secrets are available. The PR head commit is treated as diff data only:

- The script reads `KIMI_REVIEW_HEAD_SHA` and uses `git diff` against it.
- It never runs `git checkout` of the PR head.
- It never sources, imports, installs from, or executes any file from the PR head.

Reading diff text and file names from the PR head is safe. Running code from the
PR head while secrets are in scope is not.

### Shape-based CRITICAL detection

All three wrappers detect CRITICAL findings with this grep pattern:

```
[[]CRITICAL[]][^:]*:[0-9]
```

A real finding matches because the mandated format is
`[CRITICAL] path/to/file.ts:42 — description`; the path contains `:` followed by
a digit. Empty-tier placeholders like `[CRITICAL] No critical issues found.` carry
no `:<digit>` after the tag and cannot match.

The pattern is not anchored to line start, so LLM-decorated findings
(`- [CRITICAL] ...`, `**[CRITICAL]** ...`) also match and still block.

A finding that omits the line number (e.g. `[CRITICAL] schema.ts — ...`) does not
match the gate pattern and will not block a commit; it will still appear in
`additionalContext` (hook) or printed output (Husky/CI). This is an accepted
trade-off documented in the hook's inline comment.

---

## 7. False-positive design

The four root causes that produced documented false CRITICALs, and their fixes.
See the design spec for full post-mortem context.

| Class                           | Root cause                                                                                                         | Fix                                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Diff-window starvation      | Default 3-line context excluded relevant code from the hunk                                                        | `--function-context` on every `git diff` in all three wrappers and the engine's own fallback diff                                                                      |
| (2) Change-set blindness        | Reviewer saw only `.ts`/`.tsx` files; flagged absent migrations/config as missing                                  | `<changed-files>` manifest via dedicated `git diff --name-status` capture + system-prompt hardening ("NEVER raise a finding ... when it appears in `<changed-files>`") |
| (3) Non-determinism             | No `temperature` set; identical diffs gave different verdicts on re-run                                            | `temperature=0` in both engine copies                                                                                                                                  |
| (4) Stale-branch symmetric diff | `--base main` built `main..HEAD` (endpoint-to-endpoint); commits on `main` the branch lacked surfaced as deletions | Three-dot `main...HEAD` (merge-base) in `build_diff_ref`                                                                                                               |

The CI path was never affected by class (4) because `scripts/ci-kimi-review.sh`
always diffs from `git merge-base "$base_sha" "$head_sha"`.

---

## 8. Testing

### In-repo test harness

**File:** `.claude/hooks/test-kimi-review.sh`
**Run:** `bash .claude/hooks/test-kimi-review.sh` from the project root.

Tests are hermetic: a stub `kimi-review` binary and a stub `git` are injected onto
PATH via a temp dir, so no real review is invoked and no API key is needed. The
`KIMI_STUB_MODE` variable (set inside the stub) controls which output the stub emits
(e.g. `critical`, `clean-model-prose`, `echo-args`).

The harness tests:

- Command-regex matching (what git commit forms trigger the hook, what do not)
- Skip semantics for all three surfaces (`SKIP_KIMI_REVIEW=1`, missing binary)
- Tier handling (CRITICAL blocks, WARNING does not, decorated forms still block)
- Placeholder non-blocking (`[CRITICAL] No critical issues found.` must not block)
- Diff scoping (docs-only staged files skip; mixed files send only TS diff)
- `--changed-files` propagation (all three wrappers pass it)
- Python unit tests for `filter_review`, `resolve_client_config`,
  `render_changed_files`, and `build_diff_ref` (exercised via embedded
  `python3 - scripts/kimi-review.py` heredocs)

### Local engine tests

**File:** `~/.local/bin/test-kimi-review.py` (unversioned — not in git)
**Run:** `python3 ~/.local/bin/test-kimi-review.py`

Imports `~/.local/bin/kimi-review` as a module and exercises `filter_review`,
`render_changed_files`, and `build_diff_ref` directly. No API key or network needed.
Cases cover placeholders, real findings, detail continuations, bare filenames, and
the three-dot ref logic.

When changing engine logic, run both test suites to verify both copies.
