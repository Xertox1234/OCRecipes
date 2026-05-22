# Kimi Review System — Architecture Reference

**Last updated:** 2026-05-21
**Design spec:** [docs/superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md](superpowers/specs/2026-05-18-kimi-false-positive-prevention-design.md)

This document is the single source of truth for the Kimi code-review gate:
how it runs, how it blocks, how to configure it, and what invariants must hold.
All file paths are repository-relative unless otherwise stated.

---

## 1. Overview

The gate sends a staged or PR TypeScript diff to DeepSeek V4 Flash (via OpenRouter,
branded "Kimi") and produces CRITICAL, WARNING, and SUGGESTION findings via a
two-phase pipeline:

- **Phase 1 (Draft):** A single structured LLM call with `response_format` JSON
  schema returns findings in machine-readable form. Each finding carries a
  `claim_type` (`absent_symbol`, `line_assertion`, or `semantic`) alongside the
  tier, file, line, symbol, and detail.
- **Phase 2 (Verify):** An optional verification pass (selected by `--verify`)
  examines draft CRITICAL findings and may downgrade them. Verification is
  _monotonic_ — it only lowers tiers, never raises them, and never adds or drops
  findings.

The engine signals the gate result via **exit code**: `0` = clean or non-blocking
findings only; `2` = at least one CRITICAL survived verification (BLOCK); any other
non-zero = tool error (timeout, missing API key, truncation) — wrappers fail-open
and skip the gate. WARNING and SUGGESTION findings are surfaced but never block.

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

### One canonical engine, one vendored copy

The review engine is Python. There is one canonical source and one in-repo vendored
copy:

| Copy      | Path                                               | In git?                 | Used by                                    |
| --------- | -------------------------------------------------- | ----------------------- | ------------------------------------------ |
| Canonical | `~/.local/share/claude-coworker/tools/kimi-review` | No — cross-project home | Claude-Code hook, Husky (on dev machines)  |
| Vendored  | `scripts/kimi-review.py`                           | Yes                     | GitHub Actions CI job; Husky/hook fallback |

The canonical engine's shebang points at the `claude-coworker` virtualenv. The
vendored copy's shebang is normalized to `#!/usr/bin/env python3`.

The CI script discovers the engine in this order (see `scripts/ci-kimi-review.sh`):
`kimi-review` on PATH first, then `scripts/kimi-review.py`. On CI the canonical is
absent, so `scripts/kimi-review.py` runs.

Previously the two copies were maintained by hand and accumulated known drift
(credential resolution, profile support, system-prompt wording, truncation handling).
That model has been replaced by the sync mechanism below.

### Sync and drift-check

| Script                         | npm alias           | What it does                                                                |
| ------------------------------ | ------------------- | --------------------------------------------------------------------------- |
| `scripts/sync-kimi-engine.sh`  | `kimi:engine:sync`  | Copies canonical → vendored                                                 |
| `scripts/check-kimi-engine.sh` | `kimi:engine:check` | Compares vendored vs canonical modulo shebang; blocks commit if they differ |

`scripts/check-kimi-engine.sh` is wired into `.husky/pre-commit`. It **skips**
when the canonical path is absent (CI, other machines) and **enforces** when the
canonical is present (dev machines). The canonical lives outside the repo, so CI
cannot compare against it; CI instead guarantees correctness via the test harness
on the vendored copy.

### Project profiles as data

Project profiles are stored in `kimi-profiles.json` files that sit next to each
engine copy (the canonical file includes `generic`, `ocrecipes`, and `plant_id`;
the vendored file includes `generic` and `ocrecipes`). The engine loads them via
`load_profiles()` at startup. Adding or changing a project profile no longer
requires editing engine code.

### Testable seams

The engine exposes pure functions that tests can import and call without a network
or API key:

| Function                               | What it does                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `parse_findings(json_str, tiers)`      | Parses structured JSON draft; normalises tier to uppercase; returns `[]` on malformed JSON            |
| `findings_to_text(findings)`           | Renders findings to the human `[TIER] file:line — detail` format                                      |
| `apply_downgrades(findings, verdicts)` | Monotonically lowers tiers based on verification verdicts; never raises a tier or adds/drops findings |
| `load_profiles(path)`                  | Loads project profile data from a `kimi-profiles.json` file                                           |
| `render_changed_files(changed_files)`  | Wraps `git diff --name-status` text in a `<changed-files>` XML block; returns `""` for empty/None     |
| `build_diff_ref(base)`                 | Returns `"{base}...HEAD"` (three-dot merge-base) when base is given; `"HEAD~1"` otherwise             |
| `resolve_client_config(env)`           | Resolves API key + base URL from env; validates `MOONSHOT_API_KEY` requires `WORKER_BASE_URL`         |

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

**`~/.local/share/claude-coworker/tools/kimi-review` (canonical) and `scripts/kimi-review.py` (vendored):**

Both copies are now kept in sync via `scripts/sync-kimi-engine.sh`. Credential
resolution behaviour matches the `resolve_client_config` description above for
both copies.

### Review flags

| Flag                  | Default                       | Description                                                                                                                                                                             |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--tiers`             | `CRITICAL,WARNING,SUGGESTION` | Comma-separated tiers to request and return; wrappers pass `CRITICAL,WARNING`                                                                                                           |
| `--profile`           | `auto`                        | Project review profile; `auto` detects OCRecipes by repo name or `CLAUDE.md` content                                                                                                    |
| `--patterns`          | (none)                        | Comma-separated `docs/patterns` names or paths; auto-selected by wrapper path mapping                                                                                                   |
| `--rules`             | (none)                        | Comma-separated `docs/rules` names; wrappers pass same value as `--patterns`                                                                                                            |
| `--pattern-max-chars` | `12000`                       | Per-pattern truncation; `0` = full file                                                                                                                                                 |
| `--scope`             | (none)                        | One-line context injected before the diff                                                                                                                                               |
| `--changed-files`     | (none)                        | Newline-delimited `git diff --name-status` output; rendered as `<changed-files>` block                                                                                                  |
| `--base`              | (none)                        | Branch/SHA for engine's own diff; uses three-dot merge-base ref                                                                                                                         |
| `--verify`            | `off`                         | Verification mode: `off` (no verify), `deterministic` (Tier A, staged-tree checks), `agentic` (Tier B, read-only LLM loop); commit-gate wrappers use `deterministic`; CI uses `agentic` |

### Temperature

Both engine copies call the model with `temperature=0`. This collapses verdict-flipping
where the same diff yielded a CRITICAL on one run and a clean pass on re-run.
Confirmed accepted by DeepSeek V4 Flash via OpenRouter (no 400).

---

## 6. Invariants

### Husky shell execution (bash required)

Husky runs the hook as `sh -e` (see `.husky/_/h` → `sh -e "$s"`), **ignoring the
`#!/usr/bin/env bash` shebang.** Two consequences the hook must handle, or every
commit breaks:

- **errexit:** any unguarded command that exits non-zero aborts the hook. The
  CRITICAL-detection `grep` returns 1 on a clean review (no match), so it is
  guarded with `|| true` (mirrors `scripts/ci-kimi-review.sh`). Without it,
  every clean `.ts`/`.tsx` commit fails with code 1.
- **non-bash sh:** on Linux `/bin/sh` is dash, which cannot parse the hook's
  bash-only syntax (arrays, `<<<`, `$'...'`). `.husky/pre-commit` re-execs under
  bash (`if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi`) before
  `lint-staged`. On macOS `sh` is bash, so the guard is a no-op.

The test harness exercises both: `run_husky_gate` invokes `sh -e`, and
`run_husky_gate_dash` invokes `dash -e` (when dash is installed). Running the hook
with plain `bash` in tests previously masked the errexit bug.

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

### Exit-code contract

All three wrappers gate solely on the engine's exit code:

| Exit code | Meaning                                                                 | Wrapper action                                 |
| --------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `0`       | Clean or only non-blocking (WARNING/SUGGESTION) findings                | Allow commit/merge                             |
| `2`       | At least one CRITICAL survived verification                             | **BLOCK** commit/merge                         |
| other     | Tool error (timeout, missing API key, truncation, unexpected exception) | Local gates fail **open**; CI fails **closed** |

**Local-vs-CI asymmetry on tool error.** The two commit-gate wrappers
(`.claude/hooks/kimi-review.sh`, `.husky/pre-commit`) fail **open** on any non-`2`
non-zero exit — a transient tool hiccup must never block a developer's local
commit. The CI wrapper (`scripts/ci-kimi-review.sh`) instead `exit`s with the
engine's status, failing the PR job — in CI a gate that could not run should be
visible, not silently skipped. Only exit `2` blocks in every surface.

The old shape-based grep pattern (`[[]CRITICAL[]][^:]*:[0-9]`), the `filter_review`
function, and the `_FILE_REF_RE` regex have all been removed. Wrappers no longer
parse the review text to detect blocking — the exit code is the sole signal.

Defense-in-depth: `parse_findings` normalizes every finding to a complete,
well-typed dict and drops malformed ones, so a non-schema-conforming model
response cannot KeyError-crash the engine (which would exit non-`2` and, locally,
fail-open past a real CRITICAL).

### Monotonicity of verification

The verification pass (`apply_downgrades`) is strictly monotonic: it only ever
lowers a CRITICAL to WARNING, never raises a tier, never adds a finding, and never
drops a finding entirely. This means a flaky or non-deterministic verify pass can
only fail toward _keeping_ a finding (non-blocking downgrade missed), never toward
_inventing_ a new blocking one.

### Read-only tools invariant (Tier B)

The agentic verification pass (`--verify agentic`) gives the model access to
`read_file` and `grep` only. These tools perform read-only text operations against
the correct git tree for the surface (working tree locally; PR-head SHA in CI via
`git show <sha>:path` / `git grep <sha>`). The verifier never writes files, never
executes code, never checks out the PR head, and never installs or imports from PR
head code. This preserves and strengthens the `pull_request_target` security
invariant.

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

Class (5) — model fabrication (hallucinated findings with no basis in the diff) —
is addressed by the verification layer below.

---

## 8. Verification layer

The verification layer is layered on top of the class-1-through-4 fixes. It
addresses class (5): the model generating a CRITICAL finding that is factually
wrong given the actual staged code.

### Two-phase pipeline

**Phase 1 — Draft (always runs).**
The engine calls the model with `response_format={"type":"json_schema","strict":true}`
using `FINDING_SCHEMA`. The response is a JSON array of structured findings, each
with fields: `{tier, claim_type, file, line, symbol, detail}`. `parse_findings()`
parses the response, normalises `tier` to uppercase, and tier-filters; it returns
`[]` on malformed JSON. `findings_to_text()` renders the same human
`[TIER] file:line — detail` format as before.

The draft call always uses `temperature=0`.

**Phase 2 — Verify (runs when `--verify` is not `off`).**
Selected findings (CRITICALs) are examined by the verify pass.
`apply_downgrades()` applies the results: it only ever lowers CRITICAL→WARNING,
never raises a tier, never adds or drops findings (monotonicity invariant). A
flaky verify can only fail toward keeping a finding as a non-blocking WARNING;
it cannot invent a new blocking CRITICAL.

### `--verify` modes

| Mode            | Runs on                                                                             | Mechanism                                                 |
| --------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `off` (default) | —                                                                                   | No verification; draft findings are final                 |
| `deterministic` | Commit-gate wrappers (hook + Husky)                                                 | Tier A: staged-tree checks, no extra LLM call (see below) |
| `agentic`       | CI (`scripts/ci-kimi-review.sh`); also wired to `kimi-multi-review` at install time | Tier B: bounded LLM loop with read-only tools (see below) |

### Exit-code contract

The engine exits `0` (clean), `2` (BLOCK — at least one CRITICAL survived
verification), or non-zero other than 2 (tool error — wrappers fail-open). See
§6 for the full table.

### Hallucination classes and `claim_type` routing

Each structured finding carries a `claim_type` that describes what kind of
assertion the model made:

| `claim_type`     | What it asserts                                             | Verifiable by      |
| ---------------- | ----------------------------------------------------------- | ------------------ |
| `absent_symbol`  | A symbol/guard/export is missing from the staged code       | Tier A (grep)      |
| `line_assertion` | A specific file:line contains (or lacks) a particular token | Tier A (line read) |
| `semantic`       | A logical or design flaw not reducible to text presence     | Tier B only        |

### Tier A — deterministic gate verification

Tier A runs on the commit-gate surfaces (`--verify deterministic`) with no extra
LLM call. It reads the **staged tree** (`git show :path`, `git grep --cached`) and
routes by `claim_type`:

- **`absent_symbol`:** grep the staged tree for the cited symbol. If found, the
  "missing" claim is false → downgrade to WARNING. If genuinely absent → keep CRITICAL.
- **`line_assertion`:** read the cited `file:line` from the staged tree. If the
  finding's `symbol` snippet (whitespace-normalised) is present on that line →
  keep CRITICAL; otherwise → downgrade.
- **`semantic` or uncertain:** downgrade to WARNING unconditionally (the F2
  fail-safe: never block on an unverifiable claim at the gate).

F2 consequence: a real but `semantic` CRITICAL is downgraded to a non-blocking
WARNING at the commit gate. It is still printed and is caught one tier up (CI
Tier B).

### Tier B — agentic read-only verification

Tier B runs in CI (`--verify agentic`) and (to be wired at install time) the
manual `kimi-multi-review` panel. For each CRITICAL finding a bounded loop
(max ~5 turns, `temperature=0`) gives the model read-only tools (`read_file`,
`grep` — defined in `TOOL_DEFS`) to investigate the finding, then returns a
structured verdict: `verified`, `refuted`, or `uncertain`.

- `verified` → keep CRITICAL (blocks CI).
- `refuted`, `uncertain`, turn-exhaustion, or malformed verdict → downgrade to WARNING.

Per-finding loops run in parallel (`ThreadPoolExecutor`).

**Tree discipline:** tools read the correct git tree per surface — working tree
locally (`tree_ref=None`), and in CI the PR-head by SHA (`KIMI_REVIEW_HEAD_SHA`)
via `git show <sha>:path` / `git grep <sha>`. The CI base branch is never checked
out.

**Security:** the tools are read-only text operations only. They never write,
never execute PR-head code, never run `git checkout`, `tsserver`, build, or test
commands. This preserves and strengthens the `pull_request_target` invariant (see
§6).

---

## 9. Testing

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
- Python unit tests for `parse_findings`, `findings_to_text`, `apply_downgrades`,
  `resolve_client_config`, `render_changed_files`, and `build_diff_ref` (exercised
  via embedded `python3 - scripts/kimi-review.py` heredocs)

### Local engine tests

**File:** `~/.local/share/claude-coworker/tools/test-kimi-review.py` (unversioned — not in git)
**Run:** `python3 ~/.local/share/claude-coworker/tools/test-kimi-review.py`

Imports the canonical engine as a module and exercises `parse_findings`,
`findings_to_text`, `apply_downgrades`, `render_changed_files`, and
`build_diff_ref` directly. No API key or network needed.

When changing engine logic, run both test suites to verify both copies.
