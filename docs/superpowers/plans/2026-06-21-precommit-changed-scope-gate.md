# Changed-scope blocking commit gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the existing `preflight.sh` checks (type-aware lint + tsc + related unit tests) at the commit boundary, scoped to staged files, blocking the commit on failure.

**Architecture:** Add a third `--staged` mode to `scripts/preflight.sh` that scopes to `git diff --cached` and uses an incremental `tsc`; add a `check:types:incremental` npm script with a dedicated build-info cache; wire one call into `.husky/pre-commit` after `lint-staged`. A hermetic `test-*.sh` covers the branching logic via a `PREFLIGHT_DRY_RUN` echo affordance.

**Tech Stack:** Bash (macOS default bash 3.2 compatible), Husky, npm scripts, TypeScript `tsc`, ESLint (flat config, `ESLINT_NO_TYPE_AWARE` env toggle), Vitest 4 (`related` + `--exclude`).

## Global Constraints

- **bash 3.2 compatible** — no `mapfile`/`readarray`, no associative arrays. Use `while read` loops (as the existing `--fast` block does).
- **Zero CI command drift** — CI and full `preflight` keep using `check:types` (plain `tsc --noEmit`). The gate uses the new `check:types:incremental`. Do not change `check:types`.
- **Unit-only at commit** — the gate's test step excludes `server/storage/__tests__/**`; integration tests stay at the push gate.
- **Never permanently block** — escape hatches are `git commit --no-verify` (Husky standard) and `PRECOMMIT_SKIP_GATE=1`.
- **No new validation logic** — reuse the exact check commands from the `--fast` block; only the scope source, the tsc variant, and the test exclusion differ.

---

### Task 1: `check:types:incremental` npm script

**Files:**

- Modify: `package.json` (the `scripts` block)

**Interfaces:**

- Produces: npm script `check:types:incremental` that runs `tsc --noEmit` with a dedicated incremental cache at `node_modules/.cache/tsc-precommit.tsbuildinfo`. Consumed by Task 2's `--staged` mode.

- [ ] **Step 1: Add the script**

In `package.json`, immediately after the existing `"check:types": "tsc --noEmit",` line, add:

```json
"check:types:incremental": "mkdir -p node_modules/.cache && tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsc-precommit.tsbuildinfo",
```

(The `mkdir -p` guarantees the cache directory exists; `tsc` does not always create the parent of `--tsBuildInfoFile`.)

- [ ] **Step 2: Verify it runs clean on main and writes the cache**

Run: `npm run check:types:incremental && ls -la node_modules/.cache/tsc-precommit.tsbuildinfo`
Expected: exits 0 (main is CI-enforced type-clean) and the `.tsbuildinfo` file exists.

- [ ] **Step 3: Verify the second run is fast (incremental cache hit)**

Run: `time npm run check:types:incremental`
Expected: exits 0, noticeably faster than the first run (the buildinfo cache is reused).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat(preflight): add check:types:incremental npm script with dedicated cache"
```

---

### Task 2: `--staged` mode in `preflight.sh` + dry-run affordance + hermetic test

**Files:**

- Modify: `scripts/preflight.sh` (mode parsing, `run()` helper, new `--staged` block)
- Create: `.claude/hooks/test-precommit-gate.sh` (hermetic branching test; auto-run by full `preflight`'s `.claude/hooks/test-*.sh` loop)

**Interfaces:**

- Consumes: `check:types:incremental` (Task 1).
- Produces: `bash scripts/preflight.sh --staged` — exits 0 if the staged change passes type-aware lint + (when type-affecting files are staged) incremental tsc + related unit tests; non-zero otherwise. Honors `PREFLIGHT_DRY_RUN=1` (echo commands, do not execute). Consumed by Task 3's Husky wiring.

- [ ] **Step 1: Write the failing hermetic test**

Create `.claude/hooks/test-precommit-gate.sh`:

```bash
#!/usr/bin/env bash
# Tests for `scripts/preflight.sh --staged` branching (the pre-commit gate).
# Hermetic: runs in a temp git repo with PREFLIGHT_DRY_RUN=1 so the script ECHOES
# the commands it would run instead of executing real eslint/tsc/vitest. Asserts the
# DECISION (what runs for a given staged set), not the tools themselves.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/preflight.sh"
PASS=0; FAIL=0

# run_staged "path:content" ... → output of the gate (dry-run) with those files staged.
run_staged() {
  local repo out spec name content
  repo=$(mktemp -d)
  git -C "$repo" init -q
  git -C "$repo" config user.email t@t; git -C "$repo" config user.name t
  echo seed > "$repo/seed.txt"; git -C "$repo" add seed.txt; git -C "$repo" commit -qm seed
  for spec in "$@"; do
    name="${spec%%:*}"; content="${spec#*:}"
    mkdir -p "$repo/$(dirname "$name")"
    printf '%s\n' "$content" > "$repo/$name"
    git -C "$repo" add "$name"
  done
  out=$( cd "$repo" && PREFLIGHT_DRY_RUN=1 bash "$SCRIPT" --staged 2>&1 )
  rm -rf "$repo"
  printf '%s' "$out"
}

assert_runs() {   # name needle out
  if printf '%s' "$3" | grep -qF "$2"; then echo "PASS: $1"; PASS=$((PASS+1));
  else echo "FAIL: $1 (expected to run: $2)"; printf '  got: %s\n' "$3"; FAIL=$((FAIL+1)); fi
}
assert_skips() {  # name needle out
  if printf '%s' "$3" | grep -qF "$2"; then echo "FAIL: $1 (should NOT run: $2)"; printf '  got: %s\n' "$3"; FAIL=$((FAIL+1));
  else echo "PASS: $1"; PASS=$((PASS+1)); fi
}

# 1. Staged .ts → eslint + incremental tsc + vitest(unit) all run on it.
OUT=$(run_staged "server/foo.ts:export const x = 1")
assert_runs  "ts: eslint runs on the file"    "eslint server/foo.ts" "$OUT"
assert_runs  "ts: incremental tsc runs"       "check:types:incremental" "$OUT"
assert_runs  "ts: vitest related runs"        "vitest related --run server/foo.ts" "$OUT"
assert_runs  "ts: integration tests excluded" "--exclude server/storage/__tests__/**" "$OUT"

# 2. Docs-only → nothing runs.
OUT=$(run_staged "docs/note.md:hello")
assert_skips "md: no eslint"  "eslint"       "$OUT"
assert_skips "md: no tsc"     "check:types"  "$OUT"
assert_skips "md: no vitest"  "vitest"       "$OUT"

# 3. JSON-only → tsc runs (resolveJsonModule), no eslint/vitest (no .ts staged).
OUT=$(run_staged "client/data.json:{}")
assert_runs  "json: incremental tsc runs" "check:types:incremental" "$OUT"
assert_skips "json: no eslint"            "eslint" "$OUT"
assert_skips "json: no vitest"            "vitest" "$OUT"

echo ""; echo "Results: $PASS passed, $FAIL failed"; [ $FAIL -eq 0 ]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `chmod +x .claude/hooks/test-precommit-gate.sh && bash .claude/hooks/test-precommit-gate.sh`
Expected: FAIL — `scripts/preflight.sh` has no `--staged` mode yet, so it falls through to the full gate (or runs nothing matching the needles). Failures on the `assert_runs` cases.

- [ ] **Step 3: Add the dry-run affordance to `run()`**

In `scripts/preflight.sh`, replace the existing helper:

```bash
run() { echo "▶ $*"; "$@"; }
```

with:

```bash
# PREFLIGHT_DRY_RUN=1 → echo the command but do not execute (used by the gate's tests).
run() { echo "▶ $*"; [ -n "${PREFLIGHT_DRY_RUN:-}" ] && return 0; "$@"; }
```

- [ ] **Step 4: Register the `--staged` mode in parsing**

In `scripts/preflight.sh`, immediately after the existing line:

```bash
[ "${1:-}" = "--fast" ] && MODE="fast"
```

add:

```bash
[ "${1:-}" = "--staged" ] && MODE="staged"
```

- [ ] **Step 5: Add the `--staged` block**

In `scripts/preflight.sh`, immediately after the closing `fi` of the `if [ "$MODE" = "fast" ]; then … fi` block (and before the full-parity section), insert:

```bash
if [ "$MODE" = "staged" ]; then
  # Files staged for THIS commit (what is about to be committed).
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' 2>/dev/null)

  # Separate probe: anything staged that can affect types — .ts/.tsx plus .json
  # (resolveJsonModule) and tsconfig* (path/config changes a .ts-only filter misses).
  TS_AFFECTING=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.json' 'tsconfig*' 2>/dev/null)

  # Type-aware lint on staged TS files only (ESLINT_NO_TYPE_AWARE= enables type-aware).
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run env ESLINT_NO_TYPE_AWARE= npx eslint "${CHANGED[@]}" || exit 1
  fi

  # Incremental whole-program type check when any type-affecting file is staged.
  if [ -n "$TS_AFFECTING" ]; then
    run npm run check:types:incremental || exit 1
  fi

  # Unit tests reachable from the staged files. Integration tests (server/storage/__tests__)
  # are excluded — they need the dev DB, which may be stale right after a schema edit.
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run npx vitest related --run "${CHANGED[@]}" --exclude 'server/storage/__tests__/**' || exit 1
  fi

  echo "✅ preflight:staged passed"
  exit 0
fi
```

- [ ] **Step 6: Run the hermetic test to verify it passes**

Run: `bash .claude/hooks/test-precommit-gate.sh`
Expected: `Results: 10 passed, 0 failed`.

- [ ] **Step 7: Verify the real `vitest related --exclude` combination is accepted (not dry-run)**

Run: `npx vitest related --run client/constants/theme.ts --exclude 'server/storage/__tests__/**' 2>&1 | tail -5; echo "exit: ${PIPESTATUS[0]}"`
Expected: vitest starts and exits 0 (runs the theme-related unit tests, or "no related tests" — both are exit 0). It must NOT error on the flag combination.
If vitest rejects `related` + `--exclude`: fallback — drop `--exclude` and instead append `--project` filtering, or post-filter by piping the related file list; update Step 5's test command and the `assert_runs "integration tests excluded"` needle accordingly.

- [ ] **Step 8: Commit**

```bash
git add scripts/preflight.sh .claude/hooks/test-precommit-gate.sh
git commit -m "feat(preflight): add --staged mode (changed-scope commit gate) + hermetic test"
```

---

### Task 3: Wire the gate into `.husky/pre-commit`

**Files:**

- Modify: `.husky/pre-commit`

**Interfaces:**

- Consumes: `bash scripts/preflight.sh --staged` (Task 2).

- [ ] **Step 1: Append the gate call after lint-staged**

In `.husky/pre-commit`, after the existing final line:

```bash
NODE_OPTIONS="--max-old-space-size=4096" npx lint-staged --concurrent false || exit 1
```

add:

```bash

# Changed-scope gate: type-aware lint + incremental tsc + related unit tests on staged
# files. Runs after lint-staged so it validates the auto-fixed, re-staged result.
# Bypass: git commit --no-verify, or PRECOMMIT_SKIP_GATE=1.
if [ -z "${PRECOMMIT_SKIP_GATE:-}" ]; then
  bash scripts/preflight.sh --staged || exit 1
fi
```

- [ ] **Step 2: Manual end-to-end — a type error blocks the commit**

```bash
printf 'export const n: number = "not a number";\n' > /tmp/_gate_probe.ts
cp /tmp/_gate_probe.ts server/_gate_probe.ts
git add server/_gate_probe.ts
git commit -m "should be blocked"
```

Expected: commit ABORTS; output shows the `tsc` error (TS2322). `git log -1` does NOT show "should be blocked".

- [ ] **Step 3: Manual end-to-end — fixing it unblocks the commit**

```bash
printf 'export const n: number = 42;\n' > server/_gate_probe.ts
git add server/_gate_probe.ts
git commit -m "gate probe (clean)"
```

Expected: commit SUCCEEDS (`▶ … check:types:incremental` etc. then "✅ preflight:staged passed").

- [ ] **Step 4: Manual end-to-end — docs-only commit stays instant (no tsc)**

```bash
echo "probe" >> docs/note-probe.md
git add docs/note-probe.md
git commit -m "docs probe"
```

Expected: commit SUCCEEDS with no `eslint`/`check:types`/`vitest` lines (only "✅ preflight:staged passed").

- [ ] **Step 5: Clean up the probe files**

```bash
git rm -q server/_gate_probe.ts docs/note-probe.md
git commit -m "chore: remove gate probe files"
```

- [ ] **Step 6: Verify the bypass works**

```bash
echo "x" >> docs/note-probe2.md && git add docs/note-probe2.md
PRECOMMIT_SKIP_GATE=1 git commit -m "bypass probe"   # gate skipped
git rm -q docs/note-probe2.md && git commit -m "chore: remove bypass probe"
```

Expected: the `PRECOMMIT_SKIP_GATE=1` commit succeeds without running the gate.

- [ ] **Step 7: Commit the wiring** (already committed in Step 1's flow if staged separately)

```bash
git add .husky/pre-commit
git commit -m "feat(husky): run changed-scope gate at pre-commit (bypass: --no-verify | PRECOMMIT_SKIP_GATE=1)"
```

---

## Self-Review

**Spec coverage:**

- Type-aware lint on staged → Task 2 Step 5 (`env ESLINT_NO_TYPE_AWARE= npx eslint`). ✓
- Incremental tsc → Task 1 + Task 2 Step 5 (`check:types:incremental`, gated by `TS_AFFECTING`). ✓
- Unit-only related tests → Task 2 Step 5 (`vitest related … --exclude server/storage/__tests__/**`). ✓
- Staged scope (not `origin/main..HEAD`) → Task 2 Step 5 (`git diff --cached`). ✓
- tsc trigger includes .json/tsconfig → Task 2 Step 5 (`TS_AFFECTING` probe). ✓
- Skip tsc on pure-docs commit → Task 2 Step 5 (`[ -n "$TS_AFFECTING" ]`) + Task 3 Step 4. ✓
- Omit `--fast` extras → the `--staged` block does not call `build:copilot-instructions:check` / `lsp:check-agent-block`. ✓
- No CI drift (keep `check:types`) → Task 1 adds a separate script; `check:types` untouched. ✓
- Blocking + bypass → Task 3 (`|| exit 1`, `PRECOMMIT_SKIP_GATE`, `--no-verify`). ✓
- `commit-verify` synergy → no code needed (existing hook surfaces the block). ✓
- Hermetic test of branching only → Task 2 Step 1 (dry-run); real invocations verified manually (Task 2 Step 7, Task 3 Steps 2-4). ✓
- vitest `related`+`--exclude` verification + fallback → Task 2 Step 7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full content. ✓

**Type/name consistency:** `check:types:incremental`, `PREFLIGHT_DRY_RUN`, `PRECOMMIT_SKIP_GATE`, `--staged`, `CHANGED`, `TS_AFFECTING` used identically across all tasks. ✓
