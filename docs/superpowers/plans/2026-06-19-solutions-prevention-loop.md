# Prevention Loop (Pre-push Gate + Auto Known-Issue Surfacing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the "PR run failed" CI emails with a local pre-push/PR-creation gate, and make recently-codified known issues surface automatically (push) and on demand (pull) from the solutions DB.

**Architecture:** Two independent phases. **Phase 1** adds a tiered preflight (`preflight:fast` on WIP pushes; full `preflight` on PR-branch pushes and a hard gate at `gh pr create`) so lint/type/test/coverage failures are caught locally before CI. **Phase 2** adds a SessionStart recent-issues digest (push), a bug-track slot in the edit-time inject hook (push), and a `recent_solutions` CLI + MCP tool (pull). Phases share no code; Phase 1 lands first.

**Tech Stack:** Bash (husky git hooks + Claude Code PreToolUse/SessionStart hooks), Node + `tsx` (solutions-db scripts), `pg` (read-only Postgres pool), `vitest` (tests), `gh` CLI (PR detection), `psql` (digest query).

## Why this plan exists (context — the conversation will be compacted before execution)

The user gets "PR run failed" emails. Diagnosis of the last 4 failures: every one was **Lint or Tests/Coverage**, never a substantive bug. Cause: the **pre-commit hook runs a deliberately-fast subset** (`ESLINT_NO_TYPE_AWARE=1 eslint --fix` on staged files only — type-aware rules OFF, no `tsc`, no tests), while **CI runs the full type-aware lint + `tsc` + sharded tests + coverage**. So locally-green commits fail CI. A solutions DB _cannot_ prevent lint/type/test failures — that needs a **local gate** (Phase 1). Separately, the user confirmed "I don't consult the DB first," so the DB is a pull system nobody pulls — fix by surfacing automatically (Phase 2). Full design rationale: `docs/superpowers/specs/2026-06-19-solutions-prevention-loop-design.md`.

## Global Constraints

- **Fast gate budget:** `preflight:fast` must stay well under ~75s so `git push --no-verify` never tempts. Order checks cheapest-first; fail fast.
- **No CI drift:** `preflight`/`preflight:fast` are thin wrappers over the _existing_ npm scripts CI already runs. Do not reimplement checks; call the npm scripts.
- **Exact CI parity (full mode)** mirrors `.github/workflows/ci.yml`: `lint`, `lint:suppress:check`, `check:types`, `build:copilot-instructions:check`, `lsp:check-agent-block`, the four `node scripts/check-*.js`, `db:push`, `test:coverage:ci`.
- **Husky `sh -e` re-exec:** husky v9 runs hooks as `sh -e`. Any hook using bash arrays / here-strings / `[[ ]]` / `$'...'` MUST start with the re-exec preamble copied from `.husky/pre-commit` (see Task 2).
- **Fail-silent surfacing:** the SessionStart digest and the `recent` query must never block, slow, or error a session/command on a DB outage — they exit 0 silently. Mirrors the inject hook's markdown fallback.
- **DB↔markdown equivalence:** any change to `.claude/hooks/inject-patterns.sh` must keep `npm run solutions:db:hook-check` and `bash .claude/hooks/test-inject-patterns.sh` green (the DB path and the markdown-fallback path must emit identical refs).
- **Read-only DB URL:** the digest, the `recent` CLI, and the `recent_solutions` MCP tool use `SOLUTIONS_DB_READONLY_URL`. The local test DB (for `vitest related`) is `DATABASE_URL` → `postgresql://localhost/nutricam`.
- **Local-only files:** `CLAUDE.md`, `docs/superpowers/**`, and `docs/solutions/**` are gitignored — edits there are NOT committed. Solution content lives in the DB.
- **Dogfooding heads-up:** once Task 2 is committed, your _own_ subsequent `git push` runs the gate; once Task 3 is registered, your own `gh pr create` is blocked without a fresh full-`preflight` stamp — so run `npm run preflight` before opening this work's PR.

## File structure

| File                                                            | Responsibility                                                                   | Tasks |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----- |
| `scripts/preflight.sh` (create)                                 | Orchestrates fast/full checks; writes pass-stamp on full success                 | 1     |
| `package.json` (modify)                                         | Add `preflight` + `preflight:fast` scripts; add `solutions:db:recent`            | 1, 6  |
| `.husky/pre-push` (create)                                      | Picks mode by open-PR detection; runs preflight                                  | 2     |
| `.claude/hooks/pr-preflight-guard.sh` (create)                  | PreToolUse(Bash): hard-block `gh pr create` without a fresh full-preflight stamp | 3     |
| `.claude/hooks/test-pr-preflight-guard.sh` (create)             | CI hook-test for the guard                                                       | 3     |
| `.claude/settings.json` (modify)                                | Register the guard (PreToolUse) and the digest (SessionStart)                    | 3, 7  |
| `.github/workflows/ci.yml` (modify)                             | Run the guard hook-test (matches sibling hook-tests)                             | 3     |
| `CLAUDE.md` (modify, local-only)                                | Reconcile the "don't run lint/types/tests" policy                                | 4     |
| `scripts/solutions-db/lib/query-builder.ts` (modify)            | Add `buildRecentQuery` (pure SQL/param assembly)                                 | 5     |
| `scripts/solutions-db/__tests__/query-builder.test.ts` (modify) | Unit-test `buildRecentQuery`                                                     | 5     |
| `scripts/solutions-db/recent.ts` (create)                       | CLI: print recent solutions (read-only)                                          | 6     |
| `scripts/solutions-db/mcp-server.ts` (modify)                   | Register `recent_solutions` tool                                                 | 6     |
| `.claude/hooks/session-recent-issues.sh` (create)               | SessionStart: emit 14-day digest as additionalContext                            | 7     |
| `.claude/hooks/inject-patterns.sh` (modify)                     | Reserve a bug-track slot per domain                                              | 8     |

---

## Phase 1 — Pre-push / PR-creation gate

### Task 1: `preflight` orchestration script + npm wrappers

**Files:**

- Create: `scripts/preflight.sh`
- Modify: `package.json` (scripts block)

**Interfaces:**

- Produces: `npm run preflight:fast` (fast subset, exit non-zero on any failure) and `npm run preflight` (full CI parity; on success writes the HEAD sha to `/tmp/ocrecipes-preflight-pass`). Stamp path consumed by Task 3.

- [ ] **Step 1: Create the orchestration script**

Create `scripts/preflight.sh`:

```bash
#!/usr/bin/env bash
# Local pre-push / pre-PR gate. Two modes:
#   scripts/preflight.sh --fast   → fast subset (WIP pushes): tsc + changed-file
#                                   type-aware lint + cheap pattern checks + related tests.
#   scripts/preflight.sh          → full CI parity (PR-branch pushes + before gh pr create);
#                                   writes a HEAD-keyed pass-stamp on success.
# Thin wrapper over the SAME npm scripts CI runs (no drift). Exit non-zero on any failure.
set -uo pipefail

STAMP_FILE="/tmp/ocrecipes-preflight-pass"
MODE="full"
[ "${1:-}" = "--fast" ] && MODE="fast"

run() { echo "▶ $*"; "$@"; }

if [ "$MODE" = "fast" ]; then
  # Files this branch changed vs main (committed range — push gate semantics).
  # NOTE: no `mapfile` — macOS default bash is 3.2, which lacks it. Use a read loop.
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
  CHANGED=()
  while IFS= read -r f; do [ -n "$f" ] && CHANGED+=("$f"); done \
    < <(git diff --name-only --diff-filter=ACMR "$BASE" HEAD -- '*.ts' '*.tsx' 2>/dev/null)

  # Cheap, deterministic, no-DB pattern checks first (fail fast).
  run npm run build:copilot-instructions:check || exit 1
  run npm run lsp:check-agent-block || exit 1

  # Type-aware lint on changed files only (ESLINT_NO_TYPE_AWARE= enables type-aware, matching CI).
  if [ "${#CHANGED[@]}" -gt 0 ]; then
    run env ESLINT_NO_TYPE_AWARE= npx eslint "${CHANGED[@]}" || exit 1
  fi

  # Whole-program type check (cannot be scoped).
  run npm run check:types || exit 1

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

# Full CI parity — mirrors .github/workflows/ci.yml.
run npm run lint || exit 1
run npm run lint:suppress:check || exit 1
run npm run check:types || exit 1
run npm run build:copilot-instructions:check || exit 1
run npm run lsp:check-agent-block || exit 1
run node scripts/check-accessibility.js || exit 1
run node scripts/check-hardcoded-colors.js || exit 1
run node scripts/check-idor-storage.js || exit 1
run node scripts/check-jsdom-pragma.js || exit 1

# Tests + coverage need the dev DB. CI runs db:push first; mirror it unless opted out.
# NOTE: db:push mutates the local dev DB schema (stateless Drizzle push — idempotent).
if [ -z "${PREFLIGHT_SKIP_DB_PUSH:-}" ]; then
  run npm run db:push || exit 1
fi
run npm run test:coverage:ci || exit 1

# Record a fresh pass for THIS commit so the PR-creation guard (Task 3) can verify it.
git rev-parse HEAD > "$STAMP_FILE" 2>/dev/null || true
echo "✅ preflight passed — stamp written for $(git rev-parse --short HEAD 2>/dev/null)"
exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/preflight.sh`
Expected: no output, exit 0.

- [ ] **Step 3: Add the npm wrappers**

In `package.json`, add to the `"scripts"` block (next to the other `lint`/`test` scripts):

```json
    "preflight": "bash scripts/preflight.sh",
    "preflight:fast": "bash scripts/preflight.sh --fast",
```

- [ ] **Step 4: Smoke-test the fast gate (should pass on a clean tree)**

Run: `npm run preflight:fast`
Expected: prints `▶ ...` lines for each check and ends with `✅ preflight:fast passed`, exit 0. (If `vitest related` is skipped, you'll see the Postgres warning — that's fine.)

- [ ] **Step 5: Prove the fast gate catches a type error**

Temporarily append a type error to a TS file, e.g.:

```bash
echo 'const __preflight_probe: number = "x";' >> scripts/preflight-probe.ts
git add scripts/preflight-probe.ts && git commit -m "tmp: preflight probe" --no-verify
npm run preflight:fast; echo "exit=$?"
```

Expected: `check:types` step fails, `exit=1`. Then clean up:

```bash
git rm -f scripts/preflight-probe.ts && git commit -m "tmp: remove preflight probe" --no-verify
```

- [ ] **Step 6: Commit**

```bash
git add scripts/preflight.sh package.json
git commit -m "feat(gate): add tiered preflight (fast subset + full CI parity)"
```

---

### Task 2: `.husky/pre-push` hook with PR-aware mode selection

**Files:**

- Create: `.husky/pre-push`

**Interfaces:**

- Consumes: `npm run preflight:fast` / `npm run preflight` (Task 1).
- Behavior: on `git push`, runs the full `preflight` when the current branch already has an open PR (detected via `gh`); otherwise runs `preflight:fast`. Aborts the push (exit 1) on failure.

- [ ] **Step 1: Create the hook**

Create `.husky/pre-push`:

```bash
#!/usr/bin/env bash
# Pre-push gate. Picks the preflight depth by whether the branch already has an open PR:
#   open PR  → full preflight (incl. coverage) — every PR-updating push is CI-verified locally.
#   no PR    → preflight:fast (WIP iteration stays fast).
# Coverage on the FIRST (pre-PR) push is enforced separately by the gh-pr-create guard.
# Bypass (emergencies only): git push --no-verify

# Husky runs hooks as `sh -e`; re-exec under bash for arrays/[[ ]]/$'...'. (Copied from .husky/pre-commit.)
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set +e

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

MODE="fast"
if command -v gh >/dev/null 2>&1; then
  if gh pr view "$BRANCH" --json number --jq .number >/dev/null 2>&1; then
    MODE="full"
  fi
else
  echo "[pre-push] gh not found — running fast gate; coverage is enforced at gh pr create." >&2
fi

if [ "$MODE" = "full" ]; then
  echo "[pre-push] open PR detected for '$BRANCH' — running full preflight (incl. coverage)…"
  npm run preflight || { echo "[pre-push] full preflight failed — push aborted (bypass: --no-verify)."; exit 1; }
else
  echo "[pre-push] no open PR for '$BRANCH' — running fast gate…"
  npm run preflight:fast || { echo "[pre-push] fast gate failed — push aborted (bypass: --no-verify)."; exit 1; }
fi
exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x .husky/pre-push`
Expected: no output.

- [ ] **Step 3: Verify the hook fires and runs the fast gate**

Run (a no-op push that triggers the hook without needing a remote update):

```bash
git push --dry-run origin HEAD 2>&1 | head -5 || true
```

Expected: you see `[pre-push] no open PR for '<branch>' — running fast gate…` followed by the preflight output. (If you have no open PR for this branch, MODE=fast.) The push itself may be a dry-run/no-op; the hook output is what we're verifying.

> If `git push --dry-run` does not invoke the hook in your git version, instead do a real push of a throwaway commit to a scratch branch, or simulate: `BASH_VERSION=x bash .husky/pre-push origin "$(git remote get-url origin)" </dev/null`.

- [ ] **Step 4: Commit**

```bash
git add .husky/pre-push
git commit -m "feat(gate): pre-push hook runs full preflight on PR branches, fast otherwise"
```

---

### Task 3: Hard PR-creation gate — block `gh pr create` without a fresh full-preflight stamp

**Files:**

- Create: `.claude/hooks/pr-preflight-guard.sh`
- Create: `.claude/hooks/test-pr-preflight-guard.sh`
- Modify: `.claude/settings.json` (PreToolUse → Bash matcher)
- Modify: `.github/workflows/ci.yml` (add the hook-test step)

**Interfaces:**

- Consumes: the `/tmp/ocrecipes-preflight-pass` stamp written by `npm run preflight` (Task 1, full mode).
- Behavior: a PreToolUse(Bash) hook that, when the command is `gh pr create`, denies the tool call unless the stamp equals the current HEAD sha. This is the hard coverage chokepoint for the single-push `/todo` auto-merge flow (the PR doesn't exist yet at push time, so push-detection can't catch it).

- [ ] **Step 1: Write the guard hook**

Create `.claude/hooks/pr-preflight-guard.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse(Bash) — hard-block `gh pr create` unless a fresh FULL `npm run preflight`
# pass-stamp exists for the current HEAD. This guarantees lint/type/test/COVERAGE parity
# before a PR can open (the single-push /todo auto-merge flow has no PR at push time, so the
# pre-push hook cannot gate it — this does).
# Escape (emergencies): set SKIP_PR_PREFLIGHT=1 in the shell that launched Claude Code.
set -uo pipefail

[ -n "${SKIP_PR_PREFLIGHT:-}" ] && exit 0

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0

# Match `gh pr create` only (not view/list/checks/merge). Mirrors pr-verify.sh's detector.
printf '%s' "$CMD" | grep -Eq '(^|[[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)' || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
STAMP=$(cat /tmp/ocrecipes-preflight-pass 2>/dev/null || echo "")

if [ -n "$HEAD" ] && [ "$STAMP" = "$HEAD" ]; then
  exit 0   # fresh full-preflight pass for this commit — allow.
fi

FOUND="${STAMP:0:7}"; [ -z "$FOUND" ] && FOUND="none"
REASON="Blocked: run \`npm run preflight\` (full CI parity incl. coverage) before opening a PR. No fresh pass-stamp for HEAD ${HEAD:0:7} (found: ${FOUND}). This catches the lint/test/coverage failures that otherwise reach CI. Emergency bypass: SKIP_PR_PREFLIGHT=1."

jq -n --arg r "$REASON" '{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": $r
  }
}'
exit 0
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x .claude/hooks/pr-preflight-guard.sh`

- [ ] **Step 3: Write the hook-test (mirrors sibling `test-*.sh` hook tests)**

Create `.claude/hooks/test-pr-preflight-guard.sh`:

```bash
#!/usr/bin/env bash
# Unit test for pr-preflight-guard.sh. Run by CI (Lint · Types · Patterns job).
set -uo pipefail
HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/pr-preflight-guard.sh"
FAIL=0
assert_contains() { case "$3" in *"$2"*) echo "ok: $1";; *) echo "FAIL: $1 — expected '$2' in: $3"; FAIL=1;; esac; }
assert_empty()    { if [ -z "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 — expected empty, got: $3"; FAIL=1; fi; }

run_hook() { # $1=command  → stdout of hook
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(jq -Rn --arg c "$1" '$c')" | bash "$HOOK"
}

HEAD=$(git rev-parse HEAD 2>/dev/null || echo deadbeef)

# 1. Non-create gh commands pass through (no deny).
OUT=$(run_hook "gh pr view 42")
assert_empty "gh pr view passes through" "" "$OUT"

# 2. gh pr create with NO stamp → deny.
rm -f /tmp/ocrecipes-preflight-pass
OUT=$(run_hook "gh pr create --title x --body y")
assert_contains "no stamp denies create" '"permissionDecision": "deny"' "$OUT"

# 3. gh pr create with a FRESH stamp (== HEAD) → allow (no deny output).
echo "$HEAD" > /tmp/ocrecipes-preflight-pass
OUT=$(run_hook "gh pr create --title x --body y")
assert_empty "fresh stamp allows create" "" "$OUT"
rm -f /tmp/ocrecipes-preflight-pass

# 4. Bypass env → allow.
OUT=$(SKIP_PR_PREFLIGHT=1 run_hook "gh pr create --title x --body y")
assert_empty "bypass env allows create" "" "$OUT"

[ "$FAIL" -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
```

- [ ] **Step 4: Run the hook-test, verify it passes**

Run: `chmod +x .claude/hooks/test-pr-preflight-guard.sh && bash .claude/hooks/test-pr-preflight-guard.sh`
Expected: four `ok:` lines and `ALL PASS`, exit 0.

- [ ] **Step 5: Register the guard in `.claude/settings.json`**

Find the `"PreToolUse"` array (it already contains a `"matcher": "Bash"` block registering hooks like `branch-preflight.sh`/`drift-detect.sh`). Add the guard to that Bash matcher's `hooks` list:

```json
{
  "type": "command",
  "command": "bash .claude/hooks/pr-preflight-guard.sh"
}
```

(If there is no existing `"matcher": "Bash"` block, add a new object to the `PreToolUse` array: `{"matcher": "Bash", "hooks": [{"type": "command", "command": "bash .claude/hooks/pr-preflight-guard.sh"}]}`.) Verify the file is valid JSON: `jq . .claude/settings.json >/dev/null && echo OK`.

- [ ] **Step 6: Add the hook-test to CI**

In `.github/workflows/ci.yml`, in the **Lint · Types · Patterns** job, next to the existing `bash .claude/hooks/test-*.sh` steps (around the `test-pr-verify.sh` step), add:

```yaml
- name: PR preflight guard hook test
  run: bash .claude/hooks/test-pr-preflight-guard.sh
```

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/pr-preflight-guard.sh .claude/hooks/test-pr-preflight-guard.sh .claude/settings.json .github/workflows/ci.yml
git commit -m "feat(gate): hard-block gh pr create without a fresh full-preflight stamp"
```

---

### Task 4: Reconcile the CLAUDE.md policy (local-only)

**Files:**

- Modify: `CLAUDE.md` (gitignored — NOT committed)

**Interfaces:** none (documentation).

- [ ] **Step 1: Update the workflow-standards line**

In `CLAUDE.md`, find the bullet under **Workflow Standards**:

> `- CI enforces lint/types/tests on every push — do NOT run \`test:run\`, \`check:types\`, or \`lint\` at session start or to self-verify. Only run these locally when debugging a specific failure reported by CI.`

Replace it with:

```markdown
- CI enforces lint/types/tests on every push. Do NOT run `test:run`, `check:types`, or `lint` ad-hoc mid-session to self-verify — the **pre-push gate runs them for you** at the push boundary (`preflight:fast` on WIP pushes; full `preflight` on PR-branch pushes), and `gh pr create` is hard-blocked until `npm run preflight` (full CI parity incl. coverage) passes for the current HEAD. Run `npm run preflight` yourself before opening a PR. Only run the individual checks when debugging a specific failure.
```

- [ ] **Step 2: Verify (no commit — CLAUDE.md is gitignored)**

Run: `git check-ignore CLAUDE.md && echo "gitignored — local only, nothing to commit"`
Expected: prints the path and the confirmation. Phase 1 is complete.

- [ ] **Step 3: Phase 1 integration check (manual)**

Confirm the full chain on a clean tree:

```bash
npm run preflight && echo "stamp:" && cat /tmp/ocrecipes-preflight-pass && git rev-parse HEAD
```

Expected: full preflight passes; the stamp file equals current HEAD. (This is also the command you run before `gh pr create` for THIS work — the guard from Task 3 requires it.)

---

## Phase 2 — Automatic + queryable known-issue surfacing

### Task 5: `buildRecentQuery` — pure SQL/param builder + unit tests (TDD)

**Files:**

- Modify: `scripts/solutions-db/lib/query-builder.ts`
- Modify: `scripts/solutions-db/__tests__/query-builder.test.ts`

**Interfaces:**

- Produces: `buildRecentQuery(filters: RecentFilters, k: number): BuiltQuery` and `interface RecentFilters { track?: "bug" | "knowledge"; category?: string; days?: number }`. Consumed by Task 6 (CLI + MCP tool). `BuiltQuery` is the existing `{ sql: string; params: unknown[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/solutions-db/__tests__/query-builder.test.ts` (and add `buildRecentQuery` to the import on line 2-5):

```typescript
import {
  buildSearchQuery,
  buildDuplicatesCategoryClause,
  buildRecentQuery,
} from "../lib/query-builder";

describe("buildRecentQuery", () => {
  it("no filters: orders by created DESC and puts k at $1", () => {
    const { sql, params } = buildRecentQuery({}, 20);
    expect(sql).toContain("ORDER BY created DESC");
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("LIMIT $1");
    expect(params).toEqual([20]);
  });

  it("days filter goes to $1 (interval-from-today) and k to $2", () => {
    const { sql, params } = buildRecentQuery({ days: 14 }, 10);
    expect(sql).toContain("created >= (CURRENT_DATE - $1::int)");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([14, 10]);
  });

  it("track filter goes to $1 and k to $2", () => {
    const { sql, params } = buildRecentQuery({ track: "bug" }, 5);
    expect(sql).toContain("track = $1");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual(["bug", 5]);
  });

  it("days + track + category index in order ($1,$2,$3) with k at $4", () => {
    const { sql, params } = buildRecentQuery(
      { days: 30, track: "bug", category: "runtime-errors" },
      8,
    );
    expect(sql).toContain("created >= (CURRENT_DATE - $1::int)");
    expect(sql).toContain("track = $2");
    expect(sql).toContain("category = $3");
    expect(sql).toContain("LIMIT $4");
    expect(params).toEqual([30, "bug", "runtime-errors", 8]);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run scripts/solutions-db/__tests__/query-builder.test.ts`
Expected: FAIL — `buildRecentQuery is not a function` (or import error).

- [ ] **Step 3: Implement `buildRecentQuery`**

Append to `scripts/solutions-db/lib/query-builder.ts`:

```typescript
/** Optional filters for `buildRecentQuery`, in placeholder order (days, track, category). */
export interface RecentFilters {
  track?: "bug" | "knowledge";
  category?: string;
  days?: number;
}

/**
 * Build the recency-ordered SELECT for the `recent` CLI + `recent_solutions` MCP tool.
 * Pure metadata — no embedding. Optional filters take `$1..$n` in fixed order
 * (days, track, category); `LIMIT` takes the next free index. Ordered newest-first by the
 * `created` date, with `source_path` as a stable tiebreak within a day.
 */
export function buildRecentQuery(
  filters: RecentFilters,
  k: number,
): BuiltQuery {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (filters.days != null) {
    where.push(`created >= (CURRENT_DATE - $${i++}::int)`);
    params.push(filters.days);
  }
  if (filters.track) {
    where.push(`track = $${i++}`);
    params.push(filters.track);
  }
  if (filters.category) {
    where.push(`category = $${i++}`);
    params.push(filters.category);
  }
  const kIdx = i;
  params.push(k);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")} ` : "";
  const sql = `SELECT source_path, title, track, category, severity, created
         FROM solutions ${whereSql}ORDER BY created DESC, source_path DESC LIMIT $${kIdx}`;
  return { sql, params };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run scripts/solutions-db/__tests__/query-builder.test.ts`
Expected: PASS (existing `buildSearchQuery`/`buildDuplicatesCategoryClause` tests still green + 4 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/solutions-db/lib/query-builder.ts scripts/solutions-db/__tests__/query-builder.test.ts
git commit -m "feat(solutions-db): add buildRecentQuery (recency-ordered query builder)"
```

---

### Task 6: `recent` CLI + `recent_solutions` MCP tool

**Files:**

- Create: `scripts/solutions-db/recent.ts`
- Modify: `package.json` (add `solutions:db:recent`)
- Modify: `scripts/solutions-db/mcp-server.ts`

**Interfaces:**

- Consumes: `buildRecentQuery` / `RecentFilters` (Task 5), `createPool` from `./lib/db`, `SOLUTIONS_DB_READONLY_URL`.
- Produces: `npm run solutions:db:recent [-- --days N --track bug --category X --limit K]` (human table) and an MCP tool `recent_solutions` (JSON rows).

- [ ] **Step 1: Write the CLI**

Create `scripts/solutions-db/recent.ts`:

```typescript
import "dotenv/config";
import { createPool } from "./lib/db";
import { buildRecentQuery, type RecentFilters } from "./lib/query-builder";

function parseArgs(argv: string[]): { filters: RecentFilters; k: number } {
  const args = argv.filter((a) => a !== "--");
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const filters: RecentFilters = {};
  const days = get("--days");
  if (days !== undefined) filters.days = Number(days);
  const track = get("--track");
  if (track === "bug" || track === "knowledge") filters.track = track;
  const category = get("--category");
  if (category) filters.category = category;
  const limit = get("--limit");
  const k = limit !== undefined ? Number(limit) : 20;
  return { filters, k };
}

function fmtDate(d: unknown): string {
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

async function main() {
  const url = process.env.SOLUTIONS_DB_READONLY_URL;
  if (!url) {
    console.error("SOLUTIONS_DB_READONLY_URL not set");
    process.exit(1);
  }
  const { filters, k } = parseArgs(process.argv.slice(2));
  const { sql, params } = buildRecentQuery(filters, k);
  const pool = createPool(url);
  try {
    const r = await pool.query(sql, params);
    if (r.rows.length === 0) {
      console.log("No solutions match.");
      return;
    }
    for (const row of r.rows) {
      const sev = row.severity ? ` [${row.severity}]` : "";
      console.log(
        `${fmtDate(row.created)}  ${row.track}/${row.category}${sev}  ${row.title}`,
      );
      console.log(
        `    docs/solutions/${String(row.source_path).replace(/^docs\/solutions\//, "")}`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `package.json`, next to the other `solutions:db:*` scripts, add:

```json
    "solutions:db:recent": "tsx scripts/solutions-db/recent.ts",
```

- [ ] **Step 3: Smoke-test the CLI**

Run: `npm run solutions:db:recent -- --days 14 --track bug --limit 10`
Expected: a list of bug-track solutions created in the last 14 days (date, `bug/<category>`, title, path), OR `No solutions match.` Both are success (exit 0). If `SOLUTIONS_DB_READONLY_URL` is unset, it prints the error and exits 1 — set it from your shell env and retry.

- [ ] **Step 4: Register the MCP tool**

In `scripts/solutions-db/mcp-server.ts`, extend the query-builder import (currently `import { buildSearchQuery, buildDuplicatesCategoryClause } from "./lib/query-builder";`) to also import `buildRecentQuery`:

```typescript
import {
  buildSearchQuery,
  buildDuplicatesCategoryClause,
  buildRecentQuery,
} from "./lib/query-builder";
```

Then add this `registerTool` call (place it after the `stats` tool, before `sql`):

```typescript
server.registerTool(
  "recent_solutions",
  {
    description:
      "Most recently codified solutions by created date (pure metadata, no embedding). Filters: days, track, category.",
    inputSchema: {
      k: z.number().int().positive().max(50).default(20),
      days: z.number().int().positive().optional(),
      track: z.enum(["bug", "knowledge"]).optional(),
      category: z.string().optional(),
    },
  },
  async (args) => {
    const { sql, params } = buildRecentQuery(
      { days: args.days, track: args.track, category: args.category },
      args.k,
    );
    const r = await pool.query(sql, params);
    return text(r.rows);
  },
);
```

- [ ] **Step 5: Verify the MCP server still starts**

Run: `SOLUTIONS_DB_READONLY_URL="$SOLUTIONS_DB_READONLY_URL" npx tsx scripts/solutions-db/mcp-server.ts <<< "" 2>&1 | head -3`
Expected: prints `solutions-db MCP server connected (stdio).` to stderr (then exits on empty stdin). No TypeScript/throw errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/solutions-db/recent.ts scripts/solutions-db/mcp-server.ts package.json
git commit -m "feat(solutions-db): recent CLI + recent_solutions MCP tool (on-demand recency view)"
```

---

### Task 7: SessionStart recent-issues digest

**Files:**

- Create: `.claude/hooks/session-recent-issues.sh`
- Modify: `.claude/settings.json` (SessionStart array)

**Interfaces:**

- Consumes: `SOLUTIONS_DB_READONLY_URL`, `psql`.
- Behavior: at session start, emits a ≤12-line digest of solutions created in the last 14 days (bug-track first) as SessionStart `additionalContext`. Fail-silent on any error. Separate from `session-start.sh` (which exits early for local sessions) so it fires for BOTH local and remote sessions.

- [ ] **Step 1: Confirm SessionStart accepts `additionalContext`**

This is load-bearing. The inject hook uses `hookSpecificOutput.additionalContext` on PreToolUse; confirm the SessionStart event honors the same shape. Quick check of the docs/skill behavior — if SessionStart does NOT inject `additionalContext`, fall back to emitting the digest on plain stdout (SessionStart stdout is added to context). Proceed with `additionalContext`; if the digest never appears in a new session, switch the final `jq` to a plain `printf '%s\n' "$DIGEST"`.

- [ ] **Step 2: Write the digest hook**

Create `.claude/hooks/session-recent-issues.sh`:

```bash
#!/usr/bin/env bash
# SessionStart — emit a compact digest of solutions codified in the last 14 days (bug-track
# first) as additionalContext, so recent known issues surface without anyone querying the DB.
# Fail-silent: any missing tool / DB outage exits 0 with no output (never block a session).
set -uo pipefail

[ -n "${SOLUTIONS_DB_READONLY_URL:-}" ] || exit 0
command -v psql >/dev/null 2>&1 || exit 0

ROWS=$(psql "$SOLUTIONS_DB_READONLY_URL" -tAF$'\t' -c \
  "SELECT created, track, category, title, source_path
     FROM solutions
    WHERE created >= CURRENT_DATE - 14
    ORDER BY (track = 'bug') DESC, created DESC
    LIMIT 12;" 2>/dev/null) || exit 0
[ -n "$ROWS" ] || exit 0

DIGEST="[RECENT SOLUTIONS — codified in the last 14 days, bug-track first]"
DIGEST+=$'\n'"Pull more on demand: \`npm run solutions:db:recent\` or the recent_solutions MCP tool."
while IFS=$'\t' read -r created track category title source_path; do
  [ -n "$created" ] || continue
  rel="docs/solutions/${source_path#docs/solutions/}"
  DIGEST+=$'\n'"- ${created} [${track}/${category}] ${title} — ${rel}"
done <<< "$ROWS"

jq -n --arg ctx "$DIGEST" \
  '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":$ctx}}'
exit 0
```

- [ ] **Step 3: Make it executable**

Run: `chmod +x .claude/hooks/session-recent-issues.sh`

- [ ] **Step 4: Test the digest output directly**

Run: `bash .claude/hooks/session-recent-issues.sh`
Expected: a JSON object whose `additionalContext` lists recent solutions (bug-track first). If `SOLUTIONS_DB_READONLY_URL` is unset in this shell, expect NO output and exit 0 (fail-silent) — export it and re-run to see the digest.

- [ ] **Step 5: Register as a second SessionStart hook**

In `.claude/settings.json`, the `"SessionStart"` array already has one entry running `bash .claude/hooks/session-start.sh`. Add a second hook object to its `hooks` list (or a second array element with its own `hooks`):

```json
{
  "type": "command",
  "command": "bash .claude/hooks/session-recent-issues.sh",
  "timeout": 20
}
```

Verify JSON: `jq . .claude/settings.json >/dev/null && echo OK`.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/session-recent-issues.sh .claude/settings.json
git commit -m "feat(surfacing): SessionStart digest of recent (14d, bug-first) solutions"
```

---

### Task 8: Inject hook reserves a bug-track slot per domain

**Files:**

- Modify: `.claude/hooks/inject-patterns.sh` (functions `solutions_from_db` and `solutions_from_markdown`)

**Interfaces:** none external. Behavior: when a domain's newest-N solution refs (current cap `SOLUTIONS_PER_DOMAIN=4`) would otherwise be all knowledge-track, reserve the slot for the newest bug-track ref so a recent known bug always rides along.

> This is the most invasive change (the two emitters must stay byte-for-byte equivalent, enforced by `solutions:db:hook-check` + `test-inject-patterns.sh`). If keeping equivalence balloons, this task may be deferred without affecting Phase 1 or Tasks 5-7 — note that to the user rather than forcing it.

**Track determination (must be identical in both emitters):** a ref is bug-track iff its `source_path` (relative, e.g. `logic-errors/foo-2026-06-19.md`) begins with one of `logic-errors/`, `runtime-errors/`, `code-quality/`, `performance-issues/`. The DB also has a `track` column, but deriving from the category dir keeps BOTH code paths using the same input and preserves equivalence.

- [ ] **Step 1: Read the two emitter functions**

Re-read `.claude/hooks/inject-patterns.sh` lines ~80-172 (`solutions_from_markdown` and `solutions_from_db`). Both end by producing a newline-separated `rel\ttitle` list capped at `SOLUTIONS_PER_DOMAIN`, after a priority/fallback (applies_to) split. The reservation must apply to that FINAL capped list in both.

- [ ] **Step 2: Add a shared reservation helper**

Near the top of the script (after `SOLUTIONS_PER_DOMAIN=4`), add a pure function both emitters call. It takes the already-ordered candidate lines (`rel\ttitle`, newest/priority-first, MORE than the cap allowed) on stdin and the cap as `$1`, and returns the capped list but guaranteeing ≥1 bug-track line if any exists in the candidates:

```bash
# Cap a newest-first `rel<TAB>title` candidate list to $1 lines, but guarantee at least one
# bug-track line (category dir = logic-errors|runtime-errors|code-quality|performance-issues)
# survives the cap when the candidates contain one. Keeps the original order otherwise.
reserve_bug_slot() {
  local cap="$1" line rel nl=$'\n'
  local -a all=() top=() rest=()
  while IFS= read -r line; do [ -n "$line" ] && all+=("$line"); done
  # Split into the natural top-$cap and the remainder.
  local idx=0
  for line in "${all[@]}"; do
    if [ "$idx" -lt "$cap" ]; then top+=("$line"); else rest+=("$line"); fi
    idx=$((idx+1))
  done
  # Does the natural top already contain a bug-track line?
  local has_bug=false
  for line in "${top[@]}"; do
    rel="${line%%	*}"
    case "$rel" in logic-errors/*|runtime-errors/*|code-quality/*|performance-issues/*) has_bug=true; break;; esac
  done
  if [ "$has_bug" = false ] && [ "${#rest[@]}" -gt 0 ]; then
    # Find the newest bug-track line in the remainder; if present, swap it for the LAST top line.
    local bug=""
    for line in "${rest[@]}"; do
      rel="${line%%	*}"
      case "$rel" in logic-errors/*|runtime-errors/*|code-quality/*|performance-issues/*) bug="$line"; break;; esac
    done
    if [ -n "$bug" ] && [ "${#top[@]}" -gt 0 ]; then
      top[$(( ${#top[@]} - 1 ))]="$bug"
    fi
  fi
  # Guard the expansion: "${top[@]}" on an empty array errors under `set -u` in bash 3.2.
  [ "${#top[@]}" -gt 0 ] && printf '%s\n' "${top[@]}"
}
```

> The candidate `rel` here is the path WITHOUT the `docs/solutions/` prefix (both emitters compute `rel="${...#docs/solutions/}"` before this point), so the `category/` prefixes match. Confirm that when wiring.

- [ ] **Step 3: Wire `solutions_from_markdown` to reserve**

In `solutions_from_markdown`, the final loop currently emits `rel\ttitle` directly (the `printf '%s\t%s\n' "$rel" "${title:-untitled}"` at the end). Instead, build those lines into a buffer, pass the buffer through `reserve_bug_slot "$SOLUTIONS_PER_DOMAIN"` BUT first raise the internal candidate cap so a bug-track ref outside the top-N is available to swap in. Concretely: change the earlier `head -n "$SOLUTIONS_PER_DOMAIN"` that caps `matches` (after the priority/fallback merge) to keep a few extra (e.g. `head -n $((SOLUTIONS_PER_DOMAIN + 4))`), emit all of them as `rel\ttitle` into a buffer, then `printf '%s' "$buffer" | reserve_bug_slot "$SOLUTIONS_PER_DOMAIN"`.

- [ ] **Step 4: Wire `solutions_from_db` identically**

In `solutions_from_db`, the final `printf '%s\n%s\n' "$priority" "$fallback" | grep -v '^$' | head -n "$SOLUTIONS_PER_DOMAIN"` is the cap. Raise the candidate window the same way (`head -n $((SOLUTIONS_PER_DOMAIN + 4))`), build the `rel\ttitle` lines, then pipe through `reserve_bug_slot "$SOLUTIONS_PER_DOMAIN"`. The earlier date-cap that limits `rows`→`sorted` to `SOLUTIONS_PER_DOMAIN` must ALSO widen to `+4` so bug-track candidates are in scope before reservation.

- [ ] **Step 5: Run the equivalence + behavior gates**

Run:

```bash
bash .claude/hooks/test-inject-patterns.sh
npm run solutions:db:hook-check
```

Expected: both green. `solutions:db:hook-check` proves the DB path and markdown path still emit identical refs after the reservation change. If they diverge, the two emitters' reservation logic differs — reconcile until identical.

- [ ] **Step 6: Manually verify a bug surfaces**

Pick a domain known to have a recent bug-track solution (e.g., `database`) and preview the inject for a matching file:

```bash
printf '{"tool_name":"Edit","tool_input":{"file_path":"server/storage/index.ts"},"session_id":"plan-test"}' \
  | PATTERN_INJECT_NO_DEDUP=1 bash .claude/hooks/inject-patterns.sh | jq -r '.hookSpecificOutput.additionalContext' | grep -A6 'SOLUTIONS — database'
```

Expected: the `[SOLUTIONS — database]` block includes at least one `logic-errors/`, `runtime-errors/`, `code-quality/`, or `performance-issues/` ref (the reserved bug slot), assuming the domain has a recent one.

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/inject-patterns.sh
git commit -m "feat(surfacing): inject hook reserves a bug-track slot per domain"
```

---

## Self-review (completed during planning)

**Spec coverage:**

- Phase 1 gate (G1) → Tasks 1-4 (preflight scripts, pre-push hook, PR-create guard, CLAUDE.md). Coverage chokepoint hybrid = pre-push full mode on PR branches (Task 2) + hard `gh pr create` stamp guard (Task 3). ✅
- Auto surfacing (G2) → Task 7 (session digest, push) + Task 8 (inject bug-track slot, push). ✅
- Queryable recency (G3) → Tasks 5-6 (CLI + MCP tool, pull). ✅
- Deferred (recurrence counter, search recency tiebreak) → correctly absent. ✅
- Advisor plan-notes: husky `sh -e` re-exec (Task 2 Step 1) ✅; `preflight` `db:push` decision (Task 1, `PREFLIGHT_SKIP_DB_PUSH`) ✅; SessionStart `additionalContext` verification (Task 7 Step 1) ✅.

**Placeholder scan:** No TBD/TODO. The one syntax caveat (`${STAMP:0:7:-none}`) is called out with the corrected code inline (Task 3 Step 1).

**Type/name consistency:** `buildRecentQuery` / `RecentFilters` / `BuiltQuery` identical across Tasks 5-6. `/tmp/ocrecipes-preflight-pass` stamp path identical across Tasks 1 and 3. `SOLUTIONS_DB_READONLY_URL` consistent across Tasks 6-7. npm script names (`preflight`, `preflight:fast`, `solutions:db:recent`) consistent.

## Notes for the executor

- **Branch first.** Do this work on a feature branch (e.g. `feat/prevention-loop`), not `main`. The executing skill / worktree handles this; if doing it inline, `git switch -c feat/prevention-loop`.
- **Order matters only across phases.** Phase 1 (Tasks 1-4) lands first. Within Phase 2, Task 5 → 6 (6 imports Task 5's builder); Tasks 7 and 8 are independent of 5-6 and of each other (8 is the riskiest — do it last, and it's deferrable).
- **You will dogfood the gate.** After committing Task 2, your pushes run preflight. Before opening the PR for THIS work, run `npm run preflight` (Task 3's guard requires the stamp).
- **Pre-commit still runs** lint-staged on each commit; that's expected and fast.
