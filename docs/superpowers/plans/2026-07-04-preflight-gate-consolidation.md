# Preflight Gate Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the local quality gates into one semantic gate that runs once per HEAD at push, quiet on success, with coverage delegated to CI.

**Architecture:** Three local moments — commit (lint-staged only), push (fast smoke gate, skipped if HEAD already stamped), and on-demand `npm run preflight` (full CI parity). A HEAD-keyed pass-stamp is the single "this commit is verified" token: `--fast` writes it (only when its checks actually ran), pre-push reads it to skip a re-verify, and the PR-create guard reads it to allow a PR. The heavy coverage + full suite are delegated to CI, which already gates `main` via the required `Coverage thresholds` check.

**Tech Stack:** Bash (husky v9 git hooks + `scripts/preflight.sh`), Claude Code PreToolUse hook (`.claude/hooks/pr-preflight-guard.sh`), hermetic bash self-tests run via `scripts/run-hook-tests.sh` (also a CI job and part of the on-demand full preflight).

## Global Constraints

- **Branch:** all work on `chore/preflight-gate-consolidation` (already created). Never commit to `main`.
- **TDD, always:** write/modify the failing self-test first, watch it fail, then change the script, watch it pass, commit.
- **Stamp format is a bare commit SHA.** Do not add a fast/full tag — `scripts/lib/preflight-stamp-path.sh` and its path/format are **unchanged** in this plan.
- **Hermetic tests only.** Every self-test runs in a `mktemp -d` repo, clears the five inherited git-env vars (`GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR`), and uses `PREFLIGHT_STAMP_FILE` / `PREFLIGHT_DRY_RUN` overrides so it never touches the real repo or a real stamp. Reference: `docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md`.
- **Counter idiom:** `PASS=$((PASS+1))`, never `((PASS++))` (returns non-zero at 0, killing the step under CI's `-e`).
- **Self-test membership is automatic** via the `.claude/hooks/test-*.sh` glob in `scripts/run-hook-tests.sh`; a new `test-*.sh` file is picked up with no registration. After any hook-test change, run `bash scripts/run-hook-tests.sh` and confirm the trailing `✓ N hook self-tests passed`.
- **Escapes preserved:** `PREFLIGHT_DRY_RUN=1` (echo, don't execute), and this plan **adds** `PREFLIGHT_VERBOSE=1` (stream output live). `git commit --no-verify`, `git push --no-verify`, `SKIP_PR_PREFLIGHT=1` bypasses remain.
- **Philosophy A is verified safe:** `Coverage thresholds` is one of 8 **required** status checks on `main` with `enforce_admins:true` (verified live 2026-07-04) — delegating coverage to CI is a timing shift, not a protection gap.

## File Structure

| File                                         | Responsibility after this plan                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `scripts/preflight.sh`                       | Two modes only: `--fast` (smoke + conditional stamp) and full (on-demand CI parity). `run()` is quiet-on-success. `--staged` mode removed. |
| `.husky/pre-commit`                          | lint-staged only.                                                                                                                          |
| `.husky/pre-push`                            | delete/no-op skip → stamp-skip → always `npm run preflight:fast`. No `gh` detection.                                                       |
| `.claude/hooks/pr-preflight-guard.sh`        | Unchanged logic (allow on HEAD-matching stamp); corrected comment + deny message.                                                          |
| `scripts/lib/preflight-stamp-path.sh`        | **Unchanged.**                                                                                                                             |
| `.claude/hooks/test-preflight-output.sh`     | **New.** Quiet-on-success + verbose contract.                                                                                              |
| `.claude/hooks/test-preflight-fast-stamp.sh` | **New.** `--fast` conditional-stamp contract.                                                                                              |
| `.claude/hooks/test-precommit-gate.sh`       | Rewritten to static "commits stay cheap" assertions.                                                                                       |
| `.claude/hooks/test-pre-push.sh`             | Rewritten: always-fast + skip-ordering + stamp-skip.                                                                                       |
| `.claude/hooks/test-pr-preflight-guard.sh`   | Add a stale-stamp regression case.                                                                                                         |
| `CLAUDE.md` (untracked), 2 auto-memory files | Prose updates to the new model — no git commit.                                                                                            |

---

### Task 1: Quiet-on-success output in `scripts/preflight.sh`

Rewrite the `run()` wrapper to buffer command output (one `▶ …` breadcrumb, `✔` on pass, `✗` + full output on fail), add a `PREFLIGHT_VERBOSE=1` streaming escape, and stream `db:push` outside the wrapper so a `drizzle-kit` prompt can't be hidden.

**Files:**

- Modify: `scripts/preflight.sh:20` (the `run()` definition) and `scripts/preflight.sh:102-104` (the `db:push` step in full mode)
- Test: `.claude/hooks/test-preflight-output.sh` (create)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: a `run()` contract other steps rely on — **default** buffers and prints `✔ <cmd>` on success / `✗ <cmd>` + captured output on failure; `PREFLIGHT_DRY_RUN=1` echoes `▶ <cmd>` and returns 0 without executing; `PREFLIGHT_VERBOSE=1` echoes `▶ <cmd>` then streams live.

- [ ] **Step 1: Write the failing test** — create `.claude/hooks/test-preflight-output.sh`:

```bash
#!/usr/bin/env bash
# Tests scripts/preflight.sh quiet-on-success output contract:
#   - default: command output SUPPRESSED on pass (only a ✔ line); DUMPED on fail (✗ + output).
#   - PREFLIGHT_VERBOSE=1: output STREAMED even on pass.
# Drives the real script's --fast mode with a stubbed `npm`, in a temp repo with a single
# commit (so no changed .ts files → only the npm-backed steps run). Fully hermetic.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
assert_has() { if printf '%s' "$3" | grep -qF -- "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $2)"; FAIL=$((FAIL+1)); fi; }
assert_not() { if printf '%s' "$3" | grep -qF -- "$2"; then echo "FAIL: $1 (should be absent: $2)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"; mkdir -p "$BIN"
export PREFLIGHT_STAMP_FILE="$TMP/stamp"

make_repo() { local d; d=$(mktemp -d); git -C "$d" init -q; git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m only; printf '%s' "$d"; }

# --- success: npm exits 0 and prints NOISE that must be suppressed ---------------
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "NPM_NOISE_LINE"
exit 0
EOF
chmod +x "$BIN/npm"
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" bash "$SCRIPT" --fast 2>&1 ); rm -rf "$REPO"
assert_not "quiet: npm noise suppressed on success" "NPM_NOISE_LINE" "$OUT"
assert_has "quiet: shows a check summary line"      "✔" "$OUT"
assert_has "quiet: reaches the fast-pass banner"    "preflight:fast passed" "$OUT"

# --- verbose: same stub, PREFLIGHT_VERBOSE=1 → noise STREAMED --------------------
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" PREFLIGHT_VERBOSE=1 bash "$SCRIPT" --fast 2>&1 ); rm -rf "$REPO"
assert_has "verbose: npm noise streamed on success" "NPM_NOISE_LINE" "$OUT"

# --- failure: npm exits 1 with detail that MUST be dumped, non-zero exit ---------
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "NPM_FAILURE_DETAIL"
exit 1
EOF
chmod +x "$BIN/npm"
REPO=$(make_repo)
OUT=$( cd "$REPO" && PATH="$BIN:$PATH" bash "$SCRIPT" --fast 2>&1 ); RC=$?; rm -rf "$REPO"
assert_has "fail: dumps the failing command output" "NPM_FAILURE_DETAIL" "$OUT"
assert_has "fail: shows a failure marker"           "✗" "$OUT"
if [ "$RC" -ne 0 ]; then echo "PASS: fail: non-zero exit"; PASS=$((PASS+1)); else echo "FAIL: fail: expected non-zero exit"; FAIL=$((FAIL+1)); fi

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bash .claude/hooks/test-preflight-output.sh`
Expected: FAIL — `quiet: npm noise suppressed on success` fails (current `run()` streams `NPM_NOISE_LINE`).

- [ ] **Step 3: Rewrite `run()` for quiet-on-success.** Replace `scripts/preflight.sh:19-20`:

```bash
# PREFLIGHT_DRY_RUN=1 → echo the command but do not execute (used by the gate's tests).
run() { echo "▶ $*"; [ -n "${PREFLIGHT_DRY_RUN:-}" ] && return 0; "$@"; }
```

with:

```bash
# Run one step. Default: buffer output, print a ▶ breadcrumb then a one-line ✔ on success,
# or ✗ + the full captured output on failure. This keeps the happy path quiet — the script's
# output is read into an agent's context on every push. Escapes:
#   PREFLIGHT_DRY_RUN=1 → echo the command, do not execute (self-tests rely on this exact echo).
#   PREFLIGHT_VERBOSE=1 → stream output live, like the pre-2026-07 behavior.
run() {
  if [ -n "${PREFLIGHT_DRY_RUN:-}" ]; then echo "▶ $*"; return 0; fi
  if [ -n "${PREFLIGHT_VERBOSE:-}" ]; then echo "▶ $*"; "$@"; return $?; fi
  printf '▶ %s…\n' "$*"
  local out rc
  out=$("$@" 2>&1); rc=$?
  if [ "$rc" -eq 0 ]; then
    printf '✔ %s\n' "$*"
  else
    printf '✗ %s\n' "$*"
    printf '%s\n' "$out"
  fi
  return "$rc"
}
```

- [ ] **Step 4: Stream `db:push` outside the wrapper.** Replace `scripts/preflight.sh:102-104`:

```bash
if [ -z "${PREFLIGHT_SKIP_DB_PUSH:-}" ]; then
  run npm run db:push || exit 1
fi
```

with:

```bash
if [ -z "${PREFLIGHT_SKIP_DB_PUSH:-}" ]; then
  # Streamed, NOT via run(): `drizzle-kit push` can prompt on a destructive diff; buffering
  # its output would hide the prompt and hang. Only reached in on-demand full mode.
  echo "▶ npm run db:push (streamed — may prompt on a destructive diff)…"
  npm run db:push || exit 1
fi
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash .claude/hooks/test-preflight-output.sh`
Expected: PASS — `Results: N passed, 0 failed`.

- [ ] **Step 6: Run the whole hook suite to confirm no regression**

Run: `bash scripts/run-hook-tests.sh`
Expected: ends with `✓ N hook self-tests passed` (N increased by 1 for the new file). The existing `test-precommit-gate.sh` still passes because `PREFLIGHT_DRY_RUN` still echoes `▶ <cmd>`.

- [ ] **Step 7: Commit**

```bash
git add scripts/preflight.sh .claude/hooks/test-preflight-output.sh
git commit -m "refactor(preflight): quiet-on-success run() + PREFLIGHT_VERBOSE escape; stream db:push"
```

---

### Task 2: `--fast` writes a conditional pass-stamp

Make `--fast` write the HEAD stamp on success — but **only when its verification actually ran**: never when related tests were skipped because Postgres was unreachable.

**Files:**

- Modify: `scripts/preflight.sh:22-52` (the `--fast` mode block)
- Test: `.claude/hooks/test-preflight-fast-stamp.sh` (create)

**Interfaces:**

- Consumes: the `run()` contract from Task 1; `STAMP_FILE` (already defined at `scripts/preflight.sh:14` via `preflight_stamp_path`).
- Produces: after a successful `--fast`, `STAMP_FILE` contains `git rev-parse HEAD` **iff** `tests_skipped == 0` (tests ran, or no changed TS files needed them).

- [ ] **Step 1: Write the failing test** — create `.claude/hooks/test-preflight-fast-stamp.sh`:

```bash
#!/usr/bin/env bash
# Tests scripts/preflight.sh --fast conditional pass-stamp:
#   - changed TS + Postgres reachable   → tests run    → STAMP written.
#   - changed TS + Postgres unreachable → tests skipped → NO stamp (guard stays blocking).
#   - no changed TS (docs only)         → no tests needed → STAMP written.
# DRY_RUN so eslint/tsc/vitest are echoed not executed; pg_isready is STUBBED to control
# reachability; PREFLIGHT_STAMP_FILE is a throwaway per run.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0
BIN=$(mktemp -d); trap 'rm -rf "$BIN"' EXIT

pg_stub() { # $1 = exit code pg_isready returns (0 = reachable)
  cat > "$BIN/pg_isready" <<EOF
#!/usr/bin/env bash
exit $1
EOF
  chmod +x "$BIN/pg_isready"
}

make_repo() { # $1 = "ts" (changed .ts in commit B) | "none" (docs-only commit B)
  local d; d=$(mktemp -d)
  git -C "$d" init -q
  git -C "$d" -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
  if [ "$1" = "ts" ]; then echo "export const x = 1" > "$d/foo.ts"; git -C "$d" add foo.ts
  else echo "hello" > "$d/note.md"; git -C "$d" add note.md; fi
  git -C "$d" -c user.email=t@t -c user.name=t commit -q -m B
  printf '%s' "$d"
}

run_fast() { # $1 repo → runs --fast (DRY_RUN) with the pg stub + throwaway stamp; echoes stamp path
  local repo stamp; repo="$1"; stamp="$repo/.stamp"
  ( cd "$repo" && PATH="$BIN:$PATH" PREFLIGHT_DRY_RUN=1 PREFLIGHT_STAMP_FILE="$stamp" bash "$SCRIPT" --fast >/dev/null 2>&1 )
  printf '%s' "$stamp"
}

assert_stamp()    { if [ -f "$2" ]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (no stamp written)"; FAIL=$((FAIL+1)); fi; }
assert_no_stamp() { if [ -f "$2" ]; then echo "FAIL: $1 (stamp WAS written)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }

pg_stub 0; R=$(make_repo ts);   S=$(run_fast "$R"); assert_stamp    "ts + pg up → stamp"            "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo ts);   S=$(run_fast "$R"); assert_no_stamp "ts + pg down → NO stamp"        "$S"; rm -rf "$R"
pg_stub 3; R=$(make_repo none); S=$(run_fast "$R"); assert_stamp    "docs-only → stamp (pg irrelevant)" "$S"; rm -rf "$R"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bash .claude/hooks/test-preflight-fast-stamp.sh`
Expected: FAIL — `ts + pg up → stamp` fails (current `--fast` never writes a stamp).

- [ ] **Step 3: Rewrite the `--fast` block.** Replace `scripts/preflight.sh:41-51` — the tail of the `--fast` block, from the related-tests comment through `exit 0`:

```bash
  # Tests that import the changed files. Degrade to a warning if Postgres is unreachable.
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    if pg_isready -q 2>/dev/null; then
      run npx vitest related --run "${CHANGED[@]}" || exit 1
    else
      echo "⚠ Postgres not reachable — skipping related tests (they'll run in CI / full preflight)."
    fi
  fi

  echo "✅ preflight:fast passed"
  exit 0
fi
```

with:

```bash
  # Tests that import the changed files. A pass-stamp must certify EXECUTED verification,
  # so we track whether the related-tests step actually ran and refuse to stamp if it was
  # skipped for an unreachable DB (else the PR-guard would trust a stamp over zero tests).
  tests_skipped=0
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    if pg_isready -q 2>/dev/null; then
      run npx vitest related --run "${CHANGED[@]}" || exit 1
    else
      echo "⚠ Postgres not reachable — related tests SKIPPED; NOT writing a pass-stamp."
      echo "  (lint + tsc passed; PR creation stays blocked until a run that executes tests — or SKIP_PR_PREFLIGHT=1.)"
      tests_skipped=1
    fi
  fi

  echo "✅ preflight:fast passed"

  # Stamp only when verification was complete: tests ran, or none were needed (no changed TS).
  if [ "$tests_skipped" -eq 0 ]; then
    git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
    echo "✔ pass-stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
  fi
  exit 0
fi
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-preflight-fast-stamp.sh`
Expected: PASS — `Results: 3 passed, 0 failed`.

- [ ] **Step 5: Confirm Task 1's output test still passes** (it now also prints the stamp line, which it does not assert against)

Run: `bash .claude/hooks/test-preflight-output.sh`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/preflight.sh .claude/hooks/test-preflight-fast-stamp.sh
git commit -m "feat(preflight): --fast writes a HEAD pass-stamp only when its tests actually ran"
```

---

### Task 3: Remove the `--staged` mode and the per-commit semantic gate

Delete `--staged` from `scripts/preflight.sh`, strip the gate block from `.husky/pre-commit` (leaving lint-staged), and rewrite `test-precommit-gate.sh` to guard the "commits stay cheap" invariant.

**Files:**

- Modify: `scripts/preflight.sh:17` (drop the `--staged` MODE line) and `scripts/preflight.sh:54-82` (delete the entire `staged` block)
- Modify: `.husky/pre-commit` (remove the changed-scope gate block)
- Test: `.claude/hooks/test-precommit-gate.sh` (rewrite)

**Interfaces:**

- Consumes: nothing new.
- Produces: `.husky/pre-commit` runs only `npx lint-staged`; `scripts/preflight.sh` recognizes only `--fast` (anything else → full mode).

- [ ] **Step 1: Rewrite the test first** — replace the entire contents of `.claude/hooks/test-precommit-gate.sh`:

```bash
#!/usr/bin/env bash
# Guards the "commits stay cheap" invariant (2026-07-04 gate consolidation): .husky/pre-commit
# must run lint-staged ONLY — never the semantic preflight gate, which moved to pre-push.
# Static assertions on the hook text — fully hermetic, no execution.
set -uo pipefail
HOOK="$(cd "$(dirname "$0")/../.." && pwd)/.husky/pre-commit"
PASS=0; FAIL=0
check() { if eval "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1"; FAIL=$((FAIL+1)); fi; }

check "pre-commit runs lint-staged"                "grep -q 'lint-staged' '$HOOK'"
check "pre-commit does NOT run the --staged gate"  "! grep -q -- 'preflight.sh --staged' '$HOOK'"
check "pre-commit does NOT invoke any preflight"   "! grep -q 'preflight.sh' '$HOOK'"

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bash .claude/hooks/test-precommit-gate.sh`
Expected: FAIL — the current hook still contains `preflight.sh --staged`, so both negative checks fail.

- [ ] **Step 3: Strip the gate block from `.husky/pre-commit`.** Replace the entire file with:

```bash
#!/usr/bin/env bash
# Pre-commit hook: lint-staged ONLY. Fast by design — the semantic gate (type-aware lint +
# tsc + related tests) runs once at pre-push (scripts/preflight.sh --fast), not per commit.
# See docs/superpowers/specs/2026-07-04-preflight-gate-consolidation-design.md.
# Bypass: git commit --no-verify.

# Husky runs hooks as `sh -e`, ignoring the bash shebang. This script needs bash (lint-staged
# invocation is plain, but keep the re-exec so future bash-only edits are safe). On macOS `sh`
# is bash (BASH_VERSION set), so this is a no-op there.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
# Clear errexit inherited from `sh -e`; we manage exit codes explicitly.
set +e

NODE_OPTIONS="--max-old-space-size=4096" npx lint-staged --concurrent false || exit 1
```

- [ ] **Step 4: Remove `--staged` from `scripts/preflight.sh`.** Delete line `scripts/preflight.sh:17`:

```bash
[ "${1:-}" = "--staged" ] && MODE="staged"
```

- [ ] **Step 5: Delete the entire `staged` block** — remove `scripts/preflight.sh:54-82` (the block that begins `if [ "$MODE" = "staged" ]; then` and ends at its closing `fi`, inclusive, plus the blank line after it). After this edit the file goes straight from the end of the `--fast` block to the `# Full CI parity` comment.

- [ ] **Step 6: Run the rewritten test to verify it passes**

Run: `bash .claude/hooks/test-precommit-gate.sh`
Expected: PASS — `Results: 3 passed, 0 failed`.

- [ ] **Step 7: Confirm the fast/stamp/output tests are unaffected**

Run: `bash .claude/hooks/test-preflight-fast-stamp.sh && bash .claude/hooks/test-preflight-output.sh`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/preflight.sh .husky/pre-commit .claude/hooks/test-precommit-gate.sh
git commit -m "refactor(gate): drop the per-commit --staged semantic gate; commits run lint-staged only"
```

---

### Task 4: Rewrite `.husky/pre-push` — always fast, skip-ordering, stamp-skip

Replace the `gh`-based fast/full escalation with: delete/no-op skip **first**, then stamp-skip, then always `npm run preflight:fast`.

**Files:**

- Modify: `.husky/pre-push` (full rewrite)
- Test: `.claude/hooks/test-pre-push.sh` (rewrite)

**Interfaces:**

- Consumes: the pass-stamp written by `--fast` (Task 2), resolved via `scripts/lib/preflight-stamp-path.sh`.
- Produces: on push, runs `npm run preflight:fast` unless (a) the push is a delete/no-op, or (b) `git rev-parse HEAD` equals the stamp. Emits `branch deletion … skipping gate` for delete/no-op, `already verified … skipping gate` for stamp-skip.

- [ ] **Step 1: Rewrite the test first** — replace the entire contents of `.claude/hooks/test-pre-push.sh`:

```bash
#!/usr/bin/env bash
# Tests for .husky/pre-push (post-2026-07 gate consolidation). The hook now ALWAYS runs the
# fast smoke gate, except: (a) delete/no-op pushes, and (b) HEAD already carries a pass-stamp.
# There is NO gh-based full escalation anymore. Drives the real hook with the stdin git feeds a
# pre-push hook ("<local-ref> <local-sha> <remote-ref> <remote-sha>" per ref) and asserts the
# DECISION (which npm command, or none) + the skip ORDERING. `npm` is stubbed on PATH.
set -uo pipefail
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null

# Snapshot the caller's real repo to prove we never touch it.
CALLER_HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)|$(git symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_BEFORE=$(git status --porcelain 2>/dev/null || true)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOK="$ROOT/.husky/pre-push"
ZERO="0000000000000000000000000000000000000000"
PASS=0; FAIL=0

TMP=$(mktemp -d)
cleanup() { cd /; rm -rf "$TMP"; }
trap cleanup EXIT

BIN="$TMP/bin"; mkdir -p "$BIN"
export NPM_LOG="$TMP/npm.log"
cat > "$BIN/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$NPM_LOG"
exit 0
EOF
chmod +x "$BIN/npm"
export PATH="$BIN:$PATH"

# The hook sources scripts/lib/preflight-stamp-path.sh from the repo root it runs in — copy the
# REAL helper into the temp repo so stamp resolution works. The helper honors PREFLIGHT_STAMP_FILE.
mkdir -p "$TMP/scripts/lib"
cp "$ROOT/scripts/lib/preflight-stamp-path.sh" "$TMP/scripts/lib/"
export PREFLIGHT_STAMP_FILE="$TMP/stamp"

cd "$TMP"
git init -q
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m A
SHA_A=$(git rev-parse HEAD)
git -c user.email=t@t -c user.name=t commit -q --allow-empty -m B
SHA_B=$(git rev-parse HEAD)   # == HEAD

run_case() { : > "$NPM_LOG"; printf '%s' "$1" | bash "$HOOK" 2>&1; }
assert_contains() { if printf '%s' "$3" | grep -qF "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (missing: $2)"; printf '  got: %s\n' "$(printf '%s' "$3" | head -2)"; FAIL=$((FAIL+1)); fi; }
assert_absent()   { if printf '%s' "$3" | grep -qF "$2"; then echo "FAIL: $1 (present: $2)"; FAIL=$((FAIL+1)); else echo "PASS: $1"; PASS=$((PASS+1)); fi; }
assert_npm_empty(){ if [ ! -s "$NPM_LOG" ]; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (npm ran: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi; }
assert_npm_line() { if grep -qx "$2" "$NPM_LOG"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1 (npm log: $(cat "$NPM_LOG"))"; FAIL=$((FAIL+1)); fi; }

rm -f "$PREFLIGHT_STAMP_FILE"

# 1. Deletion (all-zero local sha) → skip, npm never runs.
out=$(run_case "(delete) $ZERO refs/heads/foo $SHA_B"$'\n')
assert_contains  "delete: skips gate" "skipping gate" "$out"
assert_npm_empty "delete: npm not run"

# 2. No-op re-push (empty range B..B) → skip.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_B"$'\n')
assert_contains  "no-op: skips gate" "skipping gate" "$out"
assert_npm_empty "no-op: npm not run"

# 3. New branch (remote sha zero), no stamp → fast.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $ZERO"$'\n')
assert_npm_line "new branch, no stamp: runs fast gate" "run preflight:fast"

# 4. Update push with commits, no stamp → fast (NO full escalation exists anymore).
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "update, no stamp: runs fast gate" "run preflight:fast"

# 5. HEAD already stamped → skip (npm not run).
echo "$SHA_B" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_contains  "stamped HEAD: skips gate" "already verified" "$out"
assert_npm_empty "stamped HEAD: npm not run"

# 6. Stale stamp (different sha) → fast (must re-verify a changed HEAD).
echo "$SHA_A" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "stale stamp: runs fast gate" "run preflight:fast"

# 7. ORDERING: a delete push while HEAD is stamped must take the DELETE path, not the stamp
#    path — the delete/no-op skip runs first and never consults the stamp.
echo "$SHA_B" > "$PREFLIGHT_STAMP_FILE"
out=$(run_case "(delete) $ZERO refs/heads/foo $SHA_B"$'\n')
assert_contains "delete-before-stamp: uses the delete message" "branch deletion" "$out"
assert_absent   "delete-before-stamp: did not consult stamp"   "already verified" "$out"
rm -f "$PREFLIGHT_STAMP_FILE"

# 8. Mixed delete + update in ONE push → must NOT skip (a delete line must not suppress a
#    sibling commit-bearing line).
out=$(run_case "(delete) $ZERO refs/heads/old $SHA_B"$'\n'"refs/heads/main $SHA_B refs/heads/main $SHA_A"$'\n')
assert_npm_line "mixed delete+update: runs the gate" "run preflight:fast"

# 9. rev-list fails (remote sha absent locally) → fail safe and verify, never skip.
out=$(run_case "refs/heads/main $SHA_B refs/heads/main 1111111111111111111111111111111111111111"$'\n')
assert_npm_line "unknown remote sha: fail-safe runs the gate" "run preflight:fast"

# --- Hermeticity guard: caller repo untouched ---------------------------------
CALLER_HEAD_AFTER="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)|$(git -C "$ROOT" symbolic-ref --short HEAD 2>/dev/null || true)"
CALLER_STATUS_AFTER=$(git -C "$ROOT" status --porcelain 2>/dev/null || true)
if [ "$CALLER_HEAD_BEFORE" = "$CALLER_HEAD_AFTER" ] && [ "$CALLER_STATUS_BEFORE" = "$CALLER_STATUS_AFTER" ]; then
  echo "PASS: caller repo untouched (hermetic)"; PASS=$((PASS+1));
else echo "FAIL: caller repo changed (non-hermetic leak)"; FAIL=$((FAIL+1)); fi

echo; echo "Results: $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `bash .claude/hooks/test-pre-push.sh`
Expected: FAIL — `stamped HEAD: skips gate` fails (the current hook has no stamp-skip; it runs the gate and, with `gh` absent, prints the `gh not found` line and runs fast — never `already verified`).

- [ ] **Step 3: Rewrite `.husky/pre-push`.** Replace the entire file with:

```bash
#!/usr/bin/env bash
# Pre-push gate. Always runs the fast smoke gate (scripts/preflight.sh --fast), except:
#   - delete / no-op push  → skipped (no commits to verify);
#   - HEAD already carries a fresh pass-stamp (from a prior --fast or on-demand
#     `npm run preflight`) → skipped (this exact commit was already verified).
# Coverage + the full suite are delegated to CI's required checks (the gate on main). Full
# local parity is on-demand via `npm run preflight`. Bypass (emergencies): git push --no-verify

# Husky runs hooks as `sh -e`; re-exec under bash for the sourced helper (`local`) and arrays.
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set +e

# --- (a) Skip delete / no-op pushes FIRST (never consults the stamp) -----------
# Git feeds one line per pushed ref on stdin: "<local-ref> <local-sha> <remote-ref> <remote-sha>".
# A branch DELETION has an all-zero local sha; a no-op re-push has an empty commit range. Skip
# only when EVERY pushed ref is provably a delete or empty; any uncertainty falls through.
zero="0000000000000000000000000000000000000000"
saw_ref=0
need_verify=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_ref:-}" ] && continue
  saw_ref=1
  [ "$local_sha" = "$zero" ] && continue            # deletion → nothing to verify
  if [ "$remote_sha" = "$zero" ]; then
    need_verify=1                                    # brand-new remote branch → has commits
    continue
  fi
  count=$(git rev-list --count "$remote_sha..$local_sha" 2>/dev/null) || count=""
  if [ -z "$count" ] || [ "$count" != "0" ]; then
    need_verify=1
  fi
done

if [ "$saw_ref" = 1 ] && [ "$need_verify" = 0 ]; then
  echo "[pre-push] no new commits to verify (branch deletion or up-to-date) — skipping gate."
  exit 0
fi

# --- (b) Skip when HEAD is already stamped (this exact commit was verified) -----
# Resolve the stamp via the SAME helper the writer/guard use. A missing helper or empty stamp
# fails toward RUNNING the gate (verify), never toward a false skip.
HEAD_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
STAMP=""
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
if [ -n "$ROOT" ] && [ -f "$ROOT/scripts/lib/preflight-stamp-path.sh" ]; then
  # shellcheck source=scripts/lib/preflight-stamp-path.sh
  . "$ROOT/scripts/lib/preflight-stamp-path.sh"
  STAMP=$(cat "$(preflight_stamp_path)" 2>/dev/null || echo "")
fi
if [ -n "$HEAD_SHA" ] && [ "$STAMP" = "$HEAD_SHA" ]; then
  echo "[pre-push] HEAD $(git rev-parse --short HEAD 2>/dev/null) already verified (fresh pass-stamp) — skipping gate."
  exit 0
fi

# --- (c) Run the fast smoke gate ----------------------------------------------
echo "[pre-push] running fast gate…"
npm run preflight:fast || { echo "[pre-push] fast gate failed — push aborted (bypass: --no-verify)."; exit 1; }
exit 0
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-pre-push.sh`
Expected: PASS — `Results: N passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add .husky/pre-push .claude/hooks/test-pre-push.sh
git commit -m "refactor(pre-push): always fast gate; delete-skip then stamp-skip; drop gh escalation"
```

---

### Task 5: Correct the PR-guard's wording + add a stale-stamp regression

The guard's logic already allows on any HEAD-matching stamp; only its comment and deny message are stale. Correct them and lock a stale-stamp case.

**Files:**

- Modify: `.claude/hooks/pr-preflight-guard.sh:53` (comment) and `:57` (the deny `REASON`)
- Test: `.claude/hooks/test-pr-preflight-guard.sh` (add one case)

**Interfaces:**

- Consumes: nothing new.
- Produces: unchanged behavior — allow when `STAMP == HEAD`, deny otherwise; only human-facing text changes.

- [ ] **Step 1: Add the failing/regression test.** In `.claude/hooks/test-pr-preflight-guard.sh`, insert after case 3 (the `rm -f "$STAMP_FILE"` on the line after `assert_empty "fresh stamp allows create"`):

```bash
# 3b. A stamp for a DIFFERENT sha (stale) → deny (must match HEAD exactly).
echo "0000000000000000000000000000000000000000" > "$STAMP_FILE"
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "stale stamp (wrong sha) denies" '"permissionDecision": "deny"' "$OUT"
rm -f "$STAMP_FILE"
```

- [ ] **Step 2: Run it — it should already PASS** (the guard already compares SHA equality; this is a regression lock, not a red-first change)

Run: `bash .claude/hooks/test-pr-preflight-guard.sh`
Expected: PASS, including the new `stale stamp (wrong sha) denies` line.

- [ ] **Step 3: Correct the stale comment.** In `.claude/hooks/pr-preflight-guard.sh`, replace line 53:

```bash
  exit 0   # fresh full-preflight pass for this commit — allow.
```

with:

```bash
  exit 0   # fresh pass-stamp for this commit (fast or full) — allow.
```

- [ ] **Step 4: Correct the deny message.** Replace the `REASON=` assignment at `.claude/hooks/pr-preflight-guard.sh:57`:

```bash
REASON="Blocked: run \`npm run preflight\` (full CI parity incl. coverage) before opening a PR. No fresh pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). This catches the lint/test/coverage failures that otherwise reach CI. Emergency bypass: SKIP_PR_PREFLIGHT=1."
```

with:

```bash
REASON="Blocked: no fresh preflight pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). Push the branch first — the pre-push fast gate stamps a verified HEAD — or run \`npm run preflight\` for full local parity. Coverage is enforced by CI's required checks, not here. Emergency bypass: SKIP_PR_PREFLIGHT=1."
```

- [ ] **Step 5: Re-run the guard test (unchanged behavior, new text)**

Run: `bash .claude/hooks/test-pr-preflight-guard.sh`
Expected: PASS — all cases, including cases 2/6/7/12 that still assert `"permissionDecision": "deny"` (the test asserts the decision, not the message text, so the wording change is safe).

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/pr-preflight-guard.sh .claude/hooks/test-pr-preflight-guard.sh
git commit -m "docs(pr-guard): correct stale full-preflight wording; lock stale-stamp deny"
```

---

### Task 6: Update CLAUDE.md + auto-memory (no git commit)

Bring the local, untracked instructions in line with the new model so the next session doesn't act on stale rules. **These files are untracked/external — this task produces no git commit.**

**Files:**

- Modify: `CLAUDE.md` (gitignored, repo root) — the "Workflow Standards" preflight paragraph.
- Modify: `/Users/williamtower/.claude/projects/-Users-williamtower-projects-OCRecipes/memory/project_precommit_changed_scope_gate.md`
- Modify: the PR-guard memory note referenced from `MEMORY.md` (grep `MEMORY.md` for the `pr_preflight_guard` / `precommit_changed_scope_gate` pointers; update whichever file holds the guard behavior).

- [ ] **Step 1: Update the CLAUDE.md preflight paragraph.** Find the "Workflow Standards" bullet that currently reads (the pre-push/PR-block sentence) and replace its gate description with:

```
- CI enforces lint/types/tests/coverage on every push and is the source of truth (see the
  8 required checks). Locally: **commits run lint-staged only** (fix/format + cheap pattern
  checks); **pushes run one fast smoke gate** (`preflight:fast` = type-aware lint + tsc +
  related tests) which writes a HEAD pass-stamp when its tests actually ran, and is **skipped
  when HEAD is already stamped**. `npm run preflight` (full CI parity incl. coverage) is
  **on-demand only**. PR creation (`gh pr create` or `mcp__github__create_pull_request`) is
  gated by `.claude/hooks/pr-preflight-guard.sh`, which now accepts **any** fresh HEAD-matching
  stamp (the fast gate's stamp is enough — coverage is CI's job). Bypasses: `--no-verify`,
  `PRECOMMIT_SKIP_GATE` is gone (no commit gate), `SKIP_PR_PREFLIGHT=1`. Output is quiet on
  success; `PREFLIGHT_VERBOSE=1` streams it.
```

- [ ] **Step 2: Update `project_precommit_changed_scope_gate.md`.** Read it, then rewrite the body to state: the per-commit `--staged` gate was **removed** on 2026-07-04 (commits run lint-staged only); the single semantic gate is now `preflight:fast` at pre-push; `PRECOMMIT_SKIP_GATE` no longer exists. Keep the file's `name:`/frontmatter; update `description:` to match. Link `[[auto-merge-bypasses-ci]]` (coverage-required fact).

- [ ] **Step 3: Update the PR-guard memory note.** State: the guard accepts **any** HEAD-matching stamp (fast or full); the pre-push fast gate writes that stamp (only when tests ran); coverage is enforced by CI's required `Coverage thresholds` check, not by the local guard.

- [ ] **Step 4: No commit** — these files are untracked/external. Confirm with `git status --porcelain` that only intended tracked files were touched across the branch (CLAUDE.md should NOT appear — it's gitignored).

---

### Final verification (after all tasks)

- [ ] **Run the whole hook self-test suite** (the exact runner CI and full preflight use):

Run: `bash scripts/run-hook-tests.sh`
Expected: every `▶ .claude/hooks/test-*.sh` line passes and the run ends with `✓ N hook self-tests passed` (N includes the two new files). The zero-count guard proves the glob matched.

- [ ] **Confirm the branch diff is scoped** to: `scripts/preflight.sh`, `.husky/pre-commit`, `.husky/pre-push`, `.claude/hooks/pr-preflight-guard.sh`, and the five `.claude/hooks/test-*.sh` files (two new, three modified). `scripts/lib/preflight-stamp-path.sh` must be **unchanged**.

Run: `git diff --stat main...HEAD`

- [ ] **End-to-end happens for free on push:** when this branch is pushed, the rewritten `.husky/pre-push` runs the new fast gate for real (writing the stamp), and opening the PR exercises `pr-preflight-guard.sh` against that stamp — then CI runs the full suite + coverage. No separate manual full-suite run is required; if you want to eyeball quiet output locally, run `npm run preflight:fast` (heavy: real eslint/tsc/vitest).

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:

- Gate topology (commit = lint-staged; push = fast + skip; on-demand full; CI source of truth) → Tasks 3, 4, 1.
- Stamp as unified token; `--fast` conditional stamp; pre-push skip ordering → Tasks 2, 4.
- Quiet-on-success + breadcrumb + `PREFLIGHT_VERBOSE` + `db:push` streamed → Task 1.
- PR-guard accepts fast-or-full stamp (wording only; logic already correct) → Task 5.
- Remove `--staged` mode + per-commit gate → Task 3.
- Docs/memory (CLAUDE.md + 2 memory files) → Task 6.
- Test surface (rewrite pre-push, precommit-gate, pr-guard; new output + fast-stamp tests) → Tasks 1,2,3,4,5.
- Risks (coverage=CI required; no green-stamp-over-skipped-tests) → verified in Global Constraints; enforced by Task 2.

**2. Placeholder scan** — no `TBD`/`TODO`/"handle edge cases"; every code step shows complete file content or an exact replace-this-with-that block.

**3. Type/name consistency** — `tests_skipped` (Task 2) is the only new variable and is used only within the `--fast` block. `STAMP_FILE` (Task 2 write) and `preflight_stamp_path` (Task 4 read, Task 5 read) match the existing helper's names. Messages asserted by tests match the hook exactly: `"skipping gate"`, `"branch deletion"`, `"already verified"` (Task 4 hook ↔ test), `"run preflight:fast"` (npm stub records `run preflight:fast`), `✔`/`✗`/`preflight:fast passed` (Task 1 hook ↔ test). `npm run preflight:fast` in `.husky/pre-push` → the stub logs `run preflight:fast`, matching `assert_npm_line`.
