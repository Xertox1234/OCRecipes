# Merge Review Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block merging a risk-classified PR unless a review stamp exists that the orchestrating agent did not write.

**Architecture:** A `SubagentStop` hook — invoked by the harness, not by the agent — parses each reviewer subagent's final message and writes one stamp file per reviewer into a directory keyed by repo and reviewed head SHA. A `PreToolUse` hook on the merge call classifies the PR (source type, then content risk) and, when gated, requires a matching stamp.

**Tech Stack:** bash 3.2 (macOS default), `jq`, Vitest for the one TypeScript test, Claude Code hooks.

**Spec:** `docs/superpowers/specs/2026-09-08-merge-review-gate-design.md` (rev 2). Read it before Task 1 — every task below argues from it.

## Global Constraints

- **Never commit to `main`.** Feature branch + PR. (`CLAUDE.md` → Git Workflow)
- **Commit messages go through `Write` + `git commit -F <file>`**, never `-m`. Backticks in `-m` execute.
- **`.claude/hooks/**`feeds`Outward-CLI guard corpus`, a required check on `main`.\*\* A careless edit wedges every PR. Every hook task ends with a mutation check, not just a green suite.
- **New hook test files MUST be named `.claude/hooks/test-<name>.sh`.** `scripts/run-hook-tests.sh:24` globs `.claude/hooks/test-*.sh`; a non-matching name is silently never executed.
- **Hook registrations MUST use the absolute `$CLAUDE_PROJECT_DIR` form** — enforced by `.claude/hooks/test-settings-hook-paths.sh`.
- **The writer must never run `git`.** A dispatched reviewer does not inherit the orchestrator's worktree cwd (`docs/AI_WORKFLOW.md:40`); the hook fires in that same ambient context and would read the wrong checkout. Every stamp field is asserted by the reviewer and bound by the gate.
- **Task order is load-bearing.** Task 5 activates the gate. Running it before Task 3 and Task 4 means no stamp can ever exist and every gated merge denies.

## File Structure

| File                                     | Responsibility                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `scripts/todo-automerge-guard.sh`        | (modify) add `--paths-only` so the PATH GATE is reusable without the TODO GATE |
| `.claude/hooks/lib/review-stamp-path.sh` | (create) sole definition of the stamp directory; sourced by writer and reader  |
| `docs/AI_WORKFLOW.md`                    | (modify) extend the reviewer output contract so a stamp has fields to bind     |
| `.claude/hooks/review-stamp-writer.sh`   | (create) `SubagentStop` → one stamp file per reviewer                          |
| `.claude/hooks/merge-review-guard.sh`    | (create) `PreToolUse` → classify, then require a stamp                         |
| `.claude/settings.json`                  | (modify) register both hooks                                                   |

---

### Task 1: `--paths-only` flag on the auto-merge guard

**Files:**

- Modify: `scripts/todo-automerge-guard.sh:60` (arg parsing) and the TODO GATE block (lines 191-250)
- Test: `scripts/__tests__/todo-automerge-guard.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `bash scripts/todo-automerge-guard.sh --paths-only <pr>` → exit 0 = every changed file safe; exit 1 = HOLD; exit 2 = tooling error. Default invocation (no flag) is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/todo-automerge-guard.test.ts`:

```ts
function runGuardPathsOnly(files: string[]): {
  status: number | null;
  stdout: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "guard-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH_SCRIPT);
  chmodSync(join(dir, "gh"), 0o755);
  const result = spawnSync("bash", [GUARD_SCRIPT, "--paths-only", "123"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_DIFF_FILES: files.join("\n"),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}

describe("todo-automerge-guard.sh --paths-only", () => {
  it("passes a safe diff that contains NO todos/archive file", () => {
    const { status } = runGuardPathsOnly([
      "client/screens/GroceryListScreen.tsx",
    ]);
    expect(status).toBe(0);
  });

  it("still HOLDs a sensitive path", () => {
    const { status, stdout } = runGuardPathsOnly([
      "client/hooks/useNutritionLookup.ts",
    ]);
    expect(status).toBe(1);
    expect(stdout).toContain("not on the batch-merge allowlist");
  });

  it("still HOLDs a non-allowlisted path", () => {
    const { status } = runGuardPathsOnly(["infra/deploy.yml"]);
    expect(status).toBe(1);
  });

  it("DEFAULT mode is unchanged: the same safe diff still HOLDs on the TODO GATE", () => {
    const { status, stdout } = runGuardDefault([
      "client/screens/GroceryListScreen.tsx",
    ]);
    expect(status).toBe(1);
    expect(stdout).toContain("no todos/archive/*.md in the diff");
  });
});
```

That last test is the one that matters — it proves the flag is additive. Define its helper alongside the first:

```ts
function runGuardDefault(files: string[]): {
  status: number | null;
  stdout: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "guard-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH_SCRIPT);
  chmodSync(join(dir, "gh"), 0o755);
  const result = spawnSync("bash", [GUARD_SCRIPT, "123"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH ?? ""}`,
      FAKE_GH_DIFF_FILES: files.join("\n"),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "" };
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run scripts/__tests__/todo-automerge-guard.test.ts -t "paths-only"`
Expected: FAIL — the flag is parsed as the PR number, so `gh pr diff --paths-only` is called and the fake gh exits 1.

- [ ] **Step 3: Add flag parsing**

Replace `scripts/todo-automerge-guard.sh:60`:

```bash
PR="${1:?usage: todo-automerge-guard.sh <pr-number>}"
```

with:

```bash
# --paths-only runs the PATH GATE alone. The TODO GATE answers "is this a low-priority
# todo eligible for unattended batch-merge?" — a different question from "is this content
# risky?", and it HOLDs any PR with no todos/archive file (line ~199), which would make
# the merge gate demand evidence for nearly every ordinary code PR.
PATHS_ONLY=""
if [ "${1:-}" = "--paths-only" ]; then PATHS_ONLY=1; shift; fi
PR="${1:?usage: todo-automerge-guard.sh [--paths-only] <pr-number>}"
```

- [ ] **Step 4: Guard the TODO GATE block**

Wrap the whole TODO GATE — from the `# ── TODO GATE ───` comment through the closing `done` of its `while IFS= read -r tf` loop — in:

```bash
if [ -z "$PATHS_ONLY" ]; then
  # ── TODO GATE ─────────────────────────────────────────────────────────────────
  ...unchanged body...
fi
```

Do not touch the PATH GATE (lines 252-295) or either constant.

- [ ] **Step 5: Run the full guard suite**

Run: `npx vitest run scripts/__tests__/todo-automerge-guard.test.ts`
Expected: PASS, including every pre-existing regression test.

- [ ] **Step 6: Mutation-check the default path**

Temporarily change `if [ -z "$PATHS_ONLY" ]` to `if false`, re-run the suite, confirm the pre-existing `no todos/archive` tests go RED, then revert. A green suite alone does not prove the default path is still gated.

- [ ] **Step 7: Commit**

```bash
git add scripts/todo-automerge-guard.sh scripts/__tests__/todo-automerge-guard.test.ts
git commit -F /tmp/commit-task1.txt
```

---

### Task 2: The stamp-path helper

**Files:**

- Create: `.claude/hooks/lib/review-stamp-path.sh`
- Test: `.claude/hooks/test-review-stamp-path.sh`

**Interfaces:**

- Consumes: nothing
- Produces: `review_stamp_dir <head-sha>` → prints the directory holding that SHA's stamps. Honours `REVIEW_STAMP_ROOT` as a test seam.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/test-review-stamp-path.sh`:

```bash
#!/usr/bin/env bash
# Tests for lib/review-stamp-path.sh — run from project root.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

assert_eq() {
  local name="$1" want="$2" got="$3"
  if [ "$want" = "$got" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name"; echo "  want: $want"; echo "  got:  $got"; FAIL=$((FAIL+1)); fi
}
assert_contains() {
  local name="$1" needle="$2" out="$3"
  if grep -qF -- "$needle" <<<"$out"; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name (expected substring: $needle)"; echo "  got: $out"; FAIL=$((FAIL+1)); fi
}

. "$HOOKS_DIR/lib/review-stamp-path.sh"

# 1. Test seam wins and appends the SHA segment.
out=$(REVIEW_STAMP_ROOT=/tmp/xyz review_stamp_dir abc1234)
assert_eq "REVIEW_STAMP_ROOT honoured" "/tmp/xyz/abc1234" "$out"

# 2. Real path is repo-keyed and SHA-suffixed.
out=$(review_stamp_dir deadbee)
assert_contains "real path is under the stamp root" "/tmp/ocrecipes-review-stamps-" "$out"
assert_contains "real path ends with the SHA" "/deadbee" "$out"

# 3. THE load-bearing property: two SHAs never share a directory. Linked worktrees share
#    --git-common-dir, so a /todo executor's reviewers land under the same repo key; only
#    this segment stops a background executor clobbering an interactive session's stamp.
a=$(review_stamp_dir aaaaaaa); b=$(review_stamp_dir bbbbbbb)
if [ "$a" != "$b" ]; then echo "PASS: distinct SHAs get distinct dirs"; PASS=$((PASS+1))
else echo "FAIL: distinct SHAs collided"; FAIL=$((FAIL+1)); fi

# 4. Same SHA is stable across calls (writer and reader must agree).
assert_eq "same SHA is stable" "$(review_stamp_dir cafe123)" "$(review_stamp_dir cafe123)"

# 5. Missing argument is an error, not a silent shared directory.
if ( review_stamp_dir >/dev/null 2>&1 ); then
  echo "FAIL: missing SHA should error"; FAIL=$((FAIL+1))
else echo "PASS: missing SHA errors"; PASS=$((PASS+1)); fi

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-review-stamp-path.sh`
Expected: FAIL — `lib/review-stamp-path.sh: No such file or directory`.

- [ ] **Step 3: Write the helper**

Create `.claude/hooks/lib/review-stamp-path.sh`:

```bash
#!/usr/bin/env bash
# Single source of truth for the review-stamp DIRECTORY.
#
# Sourced by BOTH the writer (.claude/hooks/review-stamp-writer.sh) and the reader
# (.claude/hooks/merge-review-guard.sh). One definition means the two cannot drift; if
# they ever did, the reader looks for a path the writer never wrote — which denies the
# merge. That is the fail-closed direction: confusing, never dangerous.
#
# Keyed by repo AND reviewed head SHA:
#   <repokey>  isolates repositories (mirrors scripts/lib/preflight-stamp-path.sh, and
#              stops one repo's hook self-test wiping another's stamps)
#   <head_sha> is LOAD-BEARING, not cosmetic. Linked worktrees share --git-common-dir,
#              so a /todo executor's reviewers resolve the SAME repokey as an interactive
#              session. Only this segment keeps up-to-4 concurrent executors from
#              clobbering each other's stamps.
#
# One FILE PER REVIEWER lives inside the directory, so parallel roster dispatch
# (docs/AI_WORKFLOW.md:21 sends code-reviewer + 1-2 domain reviewers at once) never needs
# a read-modify-write and therefore cannot race.
#
# Tests set REVIEW_STAMP_ROOT to a throwaway path so they never touch a real stamp.

review_stamp_dir() {
  local sha="${1:?usage: review_stamp_dir <head-sha>}"

  if [ -n "${REVIEW_STAMP_ROOT:-}" ]; then
    printf '%s\n' "${REVIEW_STAMP_ROOT}/${sha}"
    return 0
  fi

  local gitdir common key
  gitdir=$(git rev-parse --git-common-dir 2>/dev/null) || gitdir=""
  if [ -n "$gitdir" ]; then
    common=$( cd "$gitdir" 2>/dev/null && pwd -P )
  fi
  if [ -n "${common:-}" ]; then
    key=$(printf '%s' "$common" | shasum 2>/dev/null | cut -c1-12)
  fi
  # Deterministic fallback when git/shasum are unavailable: writer and reader still agree
  # (same code path); only per-repo isolation is lost.
  [ -z "${key:-}" ] && key="global"

  printf '%s\n' "/tmp/ocrecipes-review-stamps-${key}/${sha}"
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-review-stamp-path.sh`
Expected: `passed: 6  failed: 0`

- [ ] **Step 5: Verify the runner actually discovers the new test**

Run: `bash scripts/run-hook-tests.sh 2>&1 | grep review-stamp-path`
Expected: a `▶ .claude/hooks/test-review-stamp-path.sh` line. **If this prints nothing the test is not running** — check the filename against the `test-*.sh` glob before continuing.

- [ ] **Step 6: Commit**

```bash
git add .claude/hooks/lib/review-stamp-path.sh .claude/hooks/test-review-stamp-path.sh
git commit -F /tmp/commit-task2.txt
```

---

### Task 3: Extend the reviewer output contract

**Files:**

- Modify: `docs/AI_WORKFLOW.md:49` (the `Agent({...})` dispatch prompt) and the mandated output format below it

**Interfaces:**

- Consumes: nothing
- Produces: every roster reviewer's final message now begins with two machine-readable lines, `REVIEWED-SHA:` and `REVIEWED-FILES:`, which Task 4's writer parses.

**Why this task exists:** today's contract mandates `[CRITICAL] file:line — description` … `No findings`. That carries severity and file but **no SHA and no file list**, so a stamp would have nothing to bind on. The reviewer already runs `git -C "$WORKTREE" rev-parse --short HEAD` for the mandatory tree check (`:44`) — this asks it to echo the full SHA it saw.

- [ ] **Step 1: Update the dispatch prompt**

In `docs/AI_WORKFLOW.md`, inside the `prompt:` string, replace:

```
Return findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n[SUGGESTION] file:line — description\nIf there are no issues, return exactly: No findings.
```

with:

```
Begin your reply with exactly these two blocks, before any findings:\n\nREVIEWED-SHA: <the full sha from `git -C \"<WORKTREE>\" rev-parse HEAD`>\nREVIEWED-FILES:\n<one changed-file path per line, exactly as given to you above>\n\nThen return findings using exactly this format:\n[CRITICAL] file:line — description\n[WARNING] file:line — description\n[SUGGESTION] file:line — description\nIf there are no issues, write exactly: No findings.\n\nThe two blocks are machine-parsed by the merge review gate. Report the sha you actually observed — never one you were told; if the tree check failed, STOP and report 'wrong working tree' instead.
```

- [ ] **Step 2: Verify the rendered prompt**

Run: `sed -n '47,51p' docs/AI_WORKFLOW.md`
Expected: the `REVIEWED-SHA:` and `REVIEWED-FILES:` text appears, and the surrounding `Agent({` block is still valid — escaped `\n` sequences and `\"` quoting unchanged in style from the original.

- [ ] **Step 3: Regenerate Copilot instructions if the build check covers this file**

Run: `npm run build:copilot-instructions:check`
Expected: PASS. If it FAILS, run `npm run build:copilot-instructions` and stage the regenerated `.github/copilot-instructions.md` too.

- [ ] **Step 4: Commit**

```bash
git add docs/AI_WORKFLOW.md
git commit -F /tmp/commit-task3.txt
```

---

### Task 4: The stamp writer (`SubagentStop`)

**Files:**

- Create: `.claude/hooks/review-stamp-writer.sh`
- Modify: `.claude/settings.json` (add a `SubagentStop` registration)
- Test: `.claude/hooks/test-review-stamp-writer.sh`

**Interfaces:**

- Consumes: `review_stamp_dir <sha>` from Task 2; the `REVIEWED-SHA:` / `REVIEWED-FILES:` contract from Task 3
- Produces: `<review_stamp_dir $sha>/<agent_type>.json` containing `head_sha`, `reviewed_files_digest`, `agent_type`, `verdict`, `unresolved`, `written_by`, `written_at`. The digest is `printf '%s\n' "$sorted_files" | shasum | cut -c1-16`. Task 5 recomputes it the same way.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/test-review-stamp-writer.sh`:

```bash
#!/usr/bin/env bash
# Tests for review-stamp-writer.sh — run from project root. Hermetic: stdin JSON only,
# stamps land in a throwaway REVIEW_STAMP_ROOT. The hook must never invoke git.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/review-stamp-writer.sh"
PASS=0; FAIL=0
ROOT=$(mktemp -d "/tmp/review-stamp-writer-test-$$-XXXX")
trap 'rm -rf "$ROOT"' EXIT

run_hook() { REVIEW_STAMP_ROOT="$ROOT" bash "$HOOK" >/dev/null 2>&1; }

ok()   { echo "PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

payload() {  # $1=agent_type  $2=last_assistant_message
  jq -n --arg t "$1" --arg m "$2" \
    '{hook_event_name:"SubagentStop", agent_id:"a1", agent_type:$t, last_assistant_message:$m}'
}

CLEAN_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts
client/hooks/__tests__/useNutritionLookup.test.ts

No findings.'

FINDINGS_MSG='REVIEWED-SHA: 1234567890abcdef1234567890abcdef12345678
REVIEWED-FILES:
client/hooks/useNutritionLookup.ts

[CRITICAL] client/hooks/useNutritionLookup.ts:42 — fabricates a basis
[SUGGESTION] client/hooks/useNutritionLookup.ts:88 — rename for clarity'

SHA=1234567890abcdef1234567890abcdef12345678

# 1. A clean review writes a stamp named for the agent type.
payload "code-reviewer" "$CLEAN_MSG" | run_hook
f="$ROOT/$SHA/code-reviewer.json"
[ -f "$f" ] && ok "clean review writes a stamp" || bad "clean review writes a stamp"
[ "$(jq -r .verdict "$f" 2>/dev/null)" = "clean" ] && ok "verdict clean" || bad "verdict clean"
[ "$(jq -r .head_sha "$f" 2>/dev/null)" = "$SHA" ] && ok "head_sha recorded" || bad "head_sha recorded"

# 2. Parallel roster dispatch: a second reviewer coexists, never clobbers.
payload "server-reviewer" "$CLEAN_MSG" | run_hook
[ -f "$ROOT/$SHA/server-reviewer.json" ] && [ -f "$f" ] \
  && ok "two reviewers coexist under one SHA" || bad "two reviewers coexist under one SHA"

# 3. CRITICAL findings are recorded as unresolved; SUGGESTION is not.
payload "mobile-reviewer" "$FINDINGS_MSG" | run_hook
g="$ROOT/$SHA/mobile-reviewer.json"
[ "$(jq -r .verdict "$g" 2>/dev/null)" = "findings" ] && ok "verdict findings" || bad "verdict findings"
[ "$(jq -r '.unresolved | length' "$g" 2>/dev/null)" = "1" ] \
  && ok "only CRITICAL counts as unresolved" || bad "only CRITICAL counts as unresolved"

# 4. Refusals — a stamp must certify executed work.
before=$(find "$ROOT" -name '*.json' | wc -l | tr -d ' ')
payload "code-reviewer" "No findings." | run_hook                       # no SHA block
payload "code-reviewer" "REVIEWED-SHA: $SHA"$'\n'"No findings." | run_hook  # no FILES block
payload "" "$CLEAN_MSG" | run_hook                                       # no agent_type
printf '%s' '{"hook_event_name":"SubagentStop"}' | run_hook              # empty payload
after=$(find "$ROOT" -name '*.json' | wc -l | tr -d ' ')
[ "$before" = "$after" ] && ok "malformed payloads write nothing" || bad "malformed payloads write nothing"

# 5. The hook must not shell out to git (it has no trustworthy cwd — AI_WORKFLOW.md:40).
#    Strip comment lines FIRST: the hook's own header explains why `git rev-parse HEAD`
#    would be wrong here, and a naive grep matches that prose and fails on the explanation.
if grep -vE '^[[:space:]]*#' "$HOOK" | grep -qE '(^|[^a-z_])git '; then
  bad "hook must not invoke git"
else
  ok "hook does not invoke git"
fi

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-review-stamp-writer.sh`
Expected: FAIL — hook file does not exist.

- [ ] **Step 3: Write the hook**

Create `.claude/hooks/review-stamp-writer.sh`:

```bash
#!/usr/bin/env bash
# SubagentStop — write ONE review stamp per reviewer subagent.
#
# Registered in .claude/settings.json with an agent_type matcher so it fires only for
# roster reviewers. The orchestrating agent can neither invoke nor suppress this hook —
# that is the entire point (spec §2.2): evidence the agent did not author.
#
# THIS HOOK MUST NEVER RUN git. A dispatched reviewer does not inherit the orchestrator's
# worktree cwd (docs/AI_WORKFLOW.md:40) and this hook fires in that same ambient context,
# so `git rev-parse HEAD` here would read the MAIN CHECKOUT — plausible-looking and
# silently wrong. Every field below is ASSERTED by the reviewer and BOUND by the merge
# gate's comparison against the real PR head. That makes a stale or mis-scoped review
# detectable; it does not make a fabricated one detectable.
#
# Fail-silent: any missing tool or unparseable payload exits 0 writing nothing. A missing
# stamp denies the merge (fail-closed at the gate), so silence here is the safe direction.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)

AGENT_TYPE=$(printf '%s' "$INPUT" | jq -r '.agent_type // empty' 2>/dev/null) || exit 0
[ -n "$AGENT_TYPE" ] || exit 0
# Defend the path segment: agent_type becomes a filename.
case "$AGENT_TYPE" in *[!a-zA-Z0-9_-]*) exit 0 ;; esac

# last_assistant_message is the documented shortcut — its own describe string says it
# "Avoids the need to read and parse the transcript file". Fall back to the transcript
# when it is absent (truncation, reformatting).
MSG=$(printf '%s' "$INPUT" | jq -r '.last_assistant_message // empty' 2>/dev/null)
if [ -z "$MSG" ]; then
  TP=$(printf '%s' "$INPUT" | jq -r '.agent_transcript_path // empty' 2>/dev/null)
  if [ -n "$TP" ] && [ -r "$TP" ]; then
    MSG=$(jq -rs '[.[] | select(.type=="assistant")] | last | .message.content[]?
                  | select(.type=="text") | .text' "$TP" 2>/dev/null) || MSG=""
  fi
fi
[ -n "$MSG" ] || exit 0

# --- parse the contract (docs/AI_WORKFLOW.md:49) -------------------------------
SHA=$(printf '%s\n' "$MSG" \
      | sed -n 's/^REVIEWED-SHA:[[:space:]]*\([0-9a-f]\{7,40\}\).*/\1/p' | head -1)
[ -n "$SHA" ] || exit 0

# Everything between REVIEWED-FILES: and the first findings line / blank-line boundary.
FILES=$(printf '%s\n' "$MSG" | awk '
  /^REVIEWED-FILES:/ { collecting=1; next }
  collecting && /^\[(CRITICAL|WARNING|SUGGESTION)\]/ { collecting=0 }
  collecting && /^No findings\.?$/                   { collecting=0 }
  collecting && NF                                    { print }
' | sort -u)
[ -n "$FILES" ] || exit 0

DIGEST=$(printf '%s\n' "$FILES" | shasum 2>/dev/null | cut -c1-16)
[ -n "$DIGEST" ] || exit 0

# Only CRITICAL blocks a merge. WARNING/SUGGESTION are advisory by the same contract.
CRITICALS=$(printf '%s\n' "$MSG" | grep -E '^\[CRITICAL\]' || true)
if [ -n "$CRITICALS" ]; then VERDICT=findings; else VERDICT=clean; fi

# --- write -------------------------------------------------------------------
case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null || exit 0
declare -F review_stamp_dir >/dev/null || exit 0

DIR=$(review_stamp_dir "$SHA") || exit 0
mkdir -p "$DIR" 2>/dev/null || exit 0

jq -n \
  --arg sha "$SHA" --arg digest "$DIGEST" --arg type "$AGENT_TYPE" \
  --arg verdict "$VERDICT" --arg criticals "$CRITICALS" \
  --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
     head_sha: $sha,
     reviewed_files_digest: $digest,
     agent_type: $type,
     verdict: $verdict,
     unresolved: ($criticals | if . == "" then [] else split("\n") | map(select(. != "")) end),
     written_by: "review-stamp-writer.sh",
     written_at: $at
   }' > "$DIR/${AGENT_TYPE}.json" 2>/dev/null || exit 0

exit 0
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-review-stamp-writer.sh`
Expected: `passed: 8  failed: 0`

- [ ] **Step 5: Register the hook**

Add to `.claude/settings.json` under a new `"SubagentStop"` key (sibling of `PreToolUse`):

```json
"SubagentStop": [
  {
    "matcher": "code-reviewer|server-reviewer|mobile-reviewer|ai-reviewer|security-auditor",
    "hooks": [
      {
        "type": "command",
        "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/review-stamp-writer.sh\"",
        "timeout": 10
      }
    ]
  }
]
```

- [ ] **Step 6: Verify registration and discovery**

Run: `bash .claude/hooks/test-settings-hook-paths.sh && bash scripts/run-hook-tests.sh 2>&1 | grep review-stamp-writer`
Expected: the settings test passes AND a `▶ .claude/hooks/test-review-stamp-writer.sh` line appears.

- [ ] **Step 7: Mutation-check**

Delete the `[ -n "$SHA" ] || exit 0` line, re-run `test-review-stamp-writer.sh`, confirm case 4 goes RED, then restore it.

- [ ] **Step 8: Commit**

```bash
git add .claude/hooks/review-stamp-writer.sh .claude/hooks/test-review-stamp-writer.sh .claude/settings.json
git commit -F /tmp/commit-task4.txt
```

---

### Task 5: The merge gate (`PreToolUse`)

**Files:**

- Create: `.claude/hooks/merge-review-guard.sh`
- Modify: `.claude/settings.json` (two `PreToolUse` registrations)
- Test: `.claude/hooks/test-merge-review-guard.sh`

**Interfaces:**

- Consumes: `review_stamp_dir <sha>` (Task 2); `--paths-only` (Task 1); stamps written by Task 4; `cmd_fastpath_has`, `cmd_gh_pr_write_subcommand`, `cmd_gh_pr_ref` from the existing `.claude/hooks/lib/`
- Produces: a PreToolUse deny payload (`hookSpecificOutput.permissionDecision = "deny"`) or silent exit 0

**This task activates the gate.** Do not start it until Tasks 3 and 4 are merged, or no stamp can exist and every gated merge denies.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/test-merge-review-guard.sh`:

```bash
#!/usr/bin/env bash
# Tests for merge-review-guard.sh — run from project root. Hermetic: fake gh on PATH,
# throwaway REVIEW_STAMP_ROOT.
set -uo pipefail
HOOKS_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$HOOKS_DIR/merge-review-guard.sh"
PASS=0; FAIL=0
ROOT=$(mktemp -d "/tmp/merge-guard-test-$$-XXXX")
BIN=$(mktemp -d "/tmp/merge-guard-bin-$$-XXXX")
trap 'rm -rf "$ROOT" "$BIN"' EXIT

SHA=1234567890abcdef1234567890abcdef12345678

# Fake gh: branch name from FAKE_BRANCH, changed files from FAKE_FILES, head sha fixed.
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
set -uo pipefail
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then
  printf '%s\n' "${FAKE_VIEW_JSON}"; exit 0
fi
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "diff" ]; then
  printf '%s\n' "${FAKE_FILES}"; exit 0
fi
exit 1
GH
chmod +x "$BIN/gh"

ok()  { echo "PASS: $1"; PASS=$((PASS+1)); }
bad() { echo "FAIL: $1"; FAIL=$((FAIL+1)); }

run() {  # stdin = hook payload; env overrides via caller
  PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" bash "$HOOK" 2>/dev/null
}
mcp_payload() { jq -n --arg n "$1" '{tool_name:"mcp__github__merge_pull_request", tool_input:{pullNumber:($n|tonumber)}}'; }
bash_payload(){ jq -n --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }
denied() { grep -q '"permissionDecision": *"deny"' <<<"$1"; }

export FAKE_VIEW_JSON="{\"headRefName\":\"fix/thing\",\"headRefOid\":\"$SHA\"}"

# 1. Fast-path: an unrelated Bash command is silent and cheap.
out=$(bash_payload "npm run lint" | run)
[ -z "$out" ] && ok "unrelated Bash command exits silently" || bad "unrelated Bash command exits silently"

# 2. Stage 2 ALLOW: safe paths need no stamp.
export FAKE_FILES="docs/solutions/foo.md"
out=$(mcp_payload 938 | run)
[ -z "$out" ] && ok "safe paths allow without a stamp" || bad "safe paths allow without a stamp"

# 3. Stage 3 DENY: sensitive paths, no stamp.
export FAKE_FILES="client/hooks/useNutritionLookup.ts"
out=$(mcp_payload 938 | run)
denied "$out" && ok "sensitive paths deny with no stamp" || bad "sensitive paths deny with no stamp"

# 4. Stage 3 ALLOW: a matching clean stamp.
mkdir -p "$ROOT/$SHA"
DIGEST=$(printf '%s\n' "client/hooks/useNutritionLookup.ts" | shasum | cut -c1-16)
jq -n --arg s "$SHA" --arg d "$DIGEST" \
  '{head_sha:$s, reviewed_files_digest:$d, agent_type:"code-reviewer", verdict:"clean", unresolved:[]}' \
  > "$ROOT/$SHA/code-reviewer.json"
out=$(mcp_payload 938 | run)
[ -z "$out" ] && ok "matching clean stamp allows" || bad "matching clean stamp allows"

# 5. Mis-scoped review: digest mismatch denies even though the SHA matches.
export FAKE_FILES=$'client/hooks/useNutritionLookup.ts\nclient/hooks/useSavedItems.ts'
out=$(mcp_payload 938 | run)
denied "$out" && ok "digest mismatch denies" || bad "digest mismatch denies"

# 6. Unresolved CRITICAL denies.
export FAKE_FILES="client/hooks/useNutritionLookup.ts"
jq -n --arg s "$SHA" --arg d "$DIGEST" \
  '{head_sha:$s, reviewed_files_digest:$d, agent_type:"code-reviewer", verdict:"findings",
    unresolved:["[CRITICAL] client/hooks/useNutritionLookup.ts:42 — bad"]}' \
  > "$ROOT/$SHA/code-reviewer.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "unresolved CRITICAL denies" || bad "unresolved CRITICAL denies"
rm -f "$ROOT/$SHA/code-reviewer.json"

# 7. Stage 1: a todo/* branch whose paths are safe is exempt.
export FAKE_VIEW_JSON="{\"headRefName\":\"todo/P3-2026-01-01-x\",\"headRefOid\":\"$SHA\"}"
export FAKE_FILES=$'docs/solutions/foo.md\ntodos/archive/P3-2026-01-01-x.md'
out=$(mcp_payload 938 | run)
[ -z "$out" ] && ok "todo/* with safe paths is exempt" || bad "todo/* with safe paths is exempt"

# 8. Stage 1 does NOT shortcut a sensitive todo/* branch (the #821 shape).
export FAKE_FILES=$'client/hooks/useNutritionLookup.ts\ntodos/archive/P3-2026-01-01-x.md'
out=$(mcp_payload 938 | run)
denied "$out" && ok "todo/* with sensitive paths still denies" || bad "todo/* with sensitive paths still denies"

# 9. Self-authorization must fail: the env var inside the COMMAND is not the hook's env.
export FAKE_VIEW_JSON="{\"headRefName\":\"fix/thing\",\"headRefOid\":\"$SHA\"}"
export FAKE_FILES="client/hooks/useNutritionLookup.ts"
out=$(bash_payload "SKIP_MERGE_REVIEW=1 gh pr merge 938 --auto --squash" | run)
denied "$out" && ok "SKIP inside the command does not self-authorize" || bad "SKIP inside the command does not self-authorize"

# 10. The real env var does bypass.
out=$(bash_payload "gh pr merge 938 --auto --squash" | SKIP_MERGE_REVIEW=1 PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" bash "$HOOK" 2>/dev/null)
[ -z "$out" ] && ok "real SKIP_MERGE_REVIEW bypasses" || bad "real SKIP_MERGE_REVIEW bypasses"

# 11. Obfuscated PR ref resolves via cmd-detect, not naive splitting.
out=$(bash_payload 'gh pr merge 4$(echo 9)2 --auto' | run)
denied "$out" && ok "obfuscated ref still reaches the gate" || bad "obfuscated ref still reaches the gate"

# 12. The #938 shape: a NON-todo branch that nevertheless carries a todos/archive file
#     must not be mistaken for executor-produced. (A naive "contains a todo file" stage-1
#     test misclassifies this; the branch test does not.)
export FAKE_VIEW_JSON="{\"headRefName\":\"chore/close-a-todo\",\"headRefOid\":\"$SHA\"}"
export FAKE_FILES=$'client/hooks/useNutritionLookup.ts\ntodos/archive/P3-2026-01-01-x.md'
out=$(mcp_payload 938 | run)
denied "$out" && ok "non-todo branch carrying a todo file is not exempt" || bad "non-todo branch carrying a todo file is not exempt"

# 13. Stage 2 tooling error (exit 2) must require a stamp, not allow. Simulated by a gh
#     whose `pr diff` fails, which is what a rate-limit looks like to the guard.
cat > "$BIN/gh" <<'GHFAIL'
#!/usr/bin/env bash
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then printf '%s\n' "${FAKE_VIEW_JSON}"; exit 0; fi
exit 1
GHFAIL
chmod +x "$BIN/gh"
out=$(mcp_payload 938 | run)
denied "$out" && ok "stage-2 tooling error denies (fail-closed)" || bad "stage-2 tooling error denies (fail-closed)"
# restore the working fake gh
cat > "$BIN/gh" <<'GH'
#!/usr/bin/env bash
set -uo pipefail
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "view" ]; then printf '%s\n' "${FAKE_VIEW_JSON}"; exit 0; fi
if [ "${1:-}" = "pr" ] && [ "${2:-}" = "diff" ]; then printf '%s\n' "${FAKE_FILES}"; exit 0; fi
exit 1
GH
chmod +x "$BIN/gh"

# 14. A stamp under the WRONG sha directory does not satisfy the gate.
export FAKE_FILES="client/hooks/useNutritionLookup.ts"
mkdir -p "$ROOT/feedfacefeedfacefeedfacefeedfacefeedface"
jq -n --arg s "feedfacefeedfacefeedfacefeedfacefeedface" --arg d "$DIGEST" \
  '{head_sha:$s, reviewed_files_digest:$d, agent_type:"code-reviewer", verdict:"clean", unresolved:[]}' \
  > "$ROOT/feedfacefeedfacefeedfacefeedfacefeedface/code-reviewer.json"
out=$(mcp_payload 938 | run)
denied "$out" && ok "stamp under a different sha does not satisfy" || bad "stamp under a different sha does not satisfy"

# 15. cmd-detect.sh unsourceable => DENY, never a silent allow. Run the hook from a copy
#     whose lib/ lacks cmd-detect.sh.
BROKEN=$(mktemp -d "/tmp/merge-guard-broken-$$-XXXX")
mkdir -p "$BROKEN/lib"
cp "$HOOK" "$BROKEN/merge-review-guard.sh"
cp "$HOOKS_DIR/lib/fastpath-filter.sh" "$BROKEN/lib/" 2>/dev/null
out=$(bash_payload "gh pr merge 938 --auto --squash" \
      | PATH="$BIN:$PATH" REVIEW_STAMP_ROOT="$ROOT" bash "$BROKEN/merge-review-guard.sh" 2>/dev/null)
denied "$out" && ok "missing cmd-detect.sh denies" || bad "missing cmd-detect.sh denies"
rm -rf "$BROKEN"

echo "---"; echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `bash .claude/hooks/test-merge-review-guard.sh`
Expected: FAIL — hook file does not exist.

- [ ] **Step 3: Write the hook**

Create `.claude/hooks/merge-review-guard.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse — block merging a risk-classified PR unless a review stamp exists that this
# agent did not write. Design: docs/superpowers/specs/2026-09-08-merge-review-gate-design.md
#
# Escape (emergencies): SKIP_MERGE_REVIEW=1 in the shell that launched Claude Code.
# It is read from THIS PROCESS'S ENVIRONMENT ONLY and never parsed out of the command
# text — otherwise the agent self-authorizes by prefixing the assignment.
set -uo pipefail

[ -n "${SKIP_MERGE_REVIEW:-}" ] && exit 0

command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0

case "${BASH_SOURCE[0]}" in */*) HERE="${BASH_SOURCE[0]%/*}" ;; *) HERE=. ;; esac
ROOT="$(cd "$HERE/../.." && pwd)" || ROOT=""

deny() {
  jq -n --arg r "$1" '{
    "hookSpecificOutput": {
      "hookEventName": "PreToolUse",
      "permissionDecision": "deny",
      "permissionDecisionReason": $r
    }
  }'
  exit 0
}

PR=""
case "$TOOL" in
  Bash)
    CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
    # Fast path FIRST — this hook runs on EVERY Bash call (project_per_bash_hook_overhead).
    if . "$HERE/lib/fastpath-filter.sh" 2>/dev/null && declare -F cmd_fastpath_has >/dev/null; then
      cmd_fastpath_has "$CMD" '*gh*pr*merge*' || exit 0
    fi
    # Detection and ref resolution go through the SHARED library. Do not re-derive
    # positional extraction: cmd_gh_pr_ref's header documents three construction-proven
    # CRITICAL fixes (2026-09-02) for nested substitution, embedded quotes and backslash
    # escapes — `gh pr merge 4$(echo 9)2` resolves to 492 where naive splitting gave 42.
    if . "$HERE/lib/cmd-detect.sh" 2>/dev/null \
       && declare -F cmd_gh_pr_write_subcommand >/dev/null \
       && declare -F cmd_gh_pr_ref >/dev/null; then
      SUB=$(printf '%s' "$CMD" | cmd_gh_pr_write_subcommand)
      [ "$SUB" = "merge" ] || exit 0
      PR=$(printf '%s' "$CMD" | cmd_gh_pr_ref)
    else
      deny "Blocked: merge-review-guard could not load .claude/hooks/lib/cmd-detect.sh, so it cannot tell which PR this merges. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1 in the launching shell."
    fi
    ;;
  mcp__github__merge_pull_request)
    PR=$(printf '%s' "$INPUT" | jq -r '.tool_input.pullNumber // empty' 2>/dev/null)
    ;;
  *) exit 0 ;;
esac

case "$PR" in ''|*[!0-9]*) deny "Blocked: merge-review-guard could not resolve a numeric PR ref from this merge. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1." ;; esac

command -v gh >/dev/null 2>&1 || deny "Blocked: merge-review-guard needs \`gh\` to classify PR #$PR and it is not on PATH. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."

VIEW=$(gh pr view "$PR" --json headRefName,headRefOid 2>/dev/null) \
  || deny "Blocked: could not read PR #$PR (gh error). Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."
BRANCH=$(printf '%s' "$VIEW" | jq -r '.headRefName // empty')
HEAD_SHA=$(printf '%s' "$VIEW" | jq -r '.headRefOid // empty')
[ -n "$HEAD_SHA" ] || deny "Blocked: PR #$PR has no resolvable head sha. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."

GUARD="$ROOT/scripts/todo-automerge-guard.sh"
[ -n "$ROOT" ] && [ -f "$GUARD" ] \
  || deny "Blocked: merge-review-guard could not locate scripts/todo-automerge-guard.sh. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."

# ── STAGE 1 — source type ─────────────────────────────────────────────────────
# `todo/<slug>` is an enforced invariant (.claude/agents/todo-executor.md:474), already
# load-bearing for the executor's batch-merge skip. The NAME selects the policy; the full
# guard ENFORCES it — a todo/* branch touching sensitive paths must not shortcut (#821).
case "$BRANCH" in
  todo/*)
    if bash "$GUARD" "$PR" >/dev/null 2>&1; then exit 0; fi
    ;;
esac

# ── STAGE 2 — content risk ────────────────────────────────────────────────────
bash "$GUARD" --paths-only "$PR" >/dev/null 2>&1
case "$?" in
  0) exit 0 ;;   # every changed file safe — no stamp required
  1) : ;;        # HOLD — require a stamp
  *) : ;;        # tooling error — require a stamp (fail-closed)
esac

# ── STAGE 3 — stamp check ─────────────────────────────────────────────────────
[ -f "$HERE/lib/review-stamp-path.sh" ] \
  || deny "Blocked: merge-review-guard could not locate lib/review-stamp-path.sh. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."
. "$HERE/lib/review-stamp-path.sh" 2>/dev/null
declare -F review_stamp_dir >/dev/null \
  || deny "Blocked: review_stamp_dir unavailable. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."

DIR=$(review_stamp_dir "$HEAD_SHA")
STAMPS=$(find "$DIR" -maxdepth 1 -name '*.json' 2>/dev/null | sort)
[ -n "$STAMPS" ] || deny "Blocked: PR #$PR touches risk-classified paths and no code review is recorded for head ${HEAD_SHA:0:7}. Dispatch the reviewer roster (docs/AI_WORKFLOW.md) against this commit, then merge. Bypass: SKIP_MERGE_REVIEW=1 in the launching shell."

WANT_DIGEST=$(gh pr diff "$PR" --name-only 2>/dev/null | sed '/^$/d' | sort -u | shasum 2>/dev/null | cut -c1-16)
[ -n "$WANT_DIGEST" ] || deny "Blocked: could not read PR #$PR's changed files to verify review scope. Fail-closed. Bypass: SKIP_MERGE_REVIEW=1."

MATCHED=""
while IFS= read -r s; do
  [ -z "$s" ] && continue
  [ "$(jq -r '.head_sha // empty' "$s" 2>/dev/null)" = "$HEAD_SHA" ] || continue
  [ "$(jq -r '.reviewed_files_digest // empty' "$s" 2>/dev/null)" = "$WANT_DIGEST" ] || continue
  MATCHED=1
  if [ "$(jq -r '.unresolved | length' "$s" 2>/dev/null)" != "0" ]; then
    WHO=$(jq -r '.agent_type // "a reviewer"' "$s" 2>/dev/null)
    FIRST=$(jq -r '.unresolved[0] // ""' "$s" 2>/dev/null)
    deny "Blocked: $WHO reported an unresolved CRITICAL on PR #$PR — $FIRST. Address it and re-review against the new head, or bypass with SKIP_MERGE_REVIEW=1."
  fi
done <<< "$STAMPS"

[ -n "$MATCHED" ] || deny "Blocked: a review is recorded for head ${HEAD_SHA:0:7} but its file scope does not match PR #$PR's changed files. Re-review this commit's actual diff. Bypass: SKIP_MERGE_REVIEW=1."

exit 0
```

- [ ] **Step 4: Run to verify it passes**

Run: `bash .claude/hooks/test-merge-review-guard.sh`
Expected: `passed: 15  failed: 0`

- [ ] **Step 5: Register both matchers**

Append to the `PreToolUse` array in `.claude/settings.json`:

```json
{
  "matcher": "Bash",
  "hooks": [
    { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/merge-review-guard.sh\"", "timeout": 20 }
  ]
},
{
  "matcher": "mcp__github__merge_pull_request",
  "hooks": [
    { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/merge-review-guard.sh\"", "timeout": 20 }
  ]
}
```

- [ ] **Step 6: Verify registration, discovery, and the whole hook suite**

Run: `bash .claude/hooks/test-settings-hook-paths.sh && bash scripts/run-hook-tests.sh`
Expected: all green, and `▶ .claude/hooks/test-merge-review-guard.sh` appears in the output.

- [ ] **Step 7: Mutation-check the gate**

Change `[ -n "$STAMPS" ] || deny ...` to `[ -n "$STAMPS" ] || true`, re-run `test-merge-review-guard.sh`, confirm case 3 goes RED, then revert. Also confirm the outward-CLI corpus still passes: `bash .claude/hooks/repro-outward-cli-corpus.sh`.

- [ ] **Step 8: Regression-check the incident PRs**

Run the §1.1 classifier check from the spec against #819/#820/#821/#823 and confirm the verdicts still read GATED / not / GATED / GATED. If they have changed, the allowlist has drifted and §1.1 needs updating before merge.

- [ ] **Step 9: Commit**

```bash
git add .claude/hooks/merge-review-guard.sh .claude/hooks/test-merge-review-guard.sh .claude/settings.json
git commit -F /tmp/commit-task5.txt
```

---

## Post-implementation

- [ ] Push the branch (pre-push runs `preflight:fast` and writes the pass-stamp)
- [ ] Open the PR via `mcp__github__create_pull_request`
- [ ] **Dogfood check:** this PR touches `.claude/hooks/**` and `scripts/`, both of which the PATH GATE holds — so merging it should itself require a review stamp. If it merges without one, the gate is not wired up.
- [ ] After merge, update the spec's status line from "design, not approved for implementation" to shipped, and record the measured coverage at that date.

## Known gaps carried from the spec — do not treat as bugs

- **64% coverage.** Measured 2026-09-08: 32 GATED / 18 ALLOWED over 50 commits. The ungated third is by design.
- **Sincerity is not enforced.** The agent picks the reviewer and its prompt; stage 3 denies on CRITICAL, which creates pressure toward a compliant reviewer. Spec §7.
- **Fields are asserted, not measured.** The writer has no trustworthy cwd. Spec §6.2.
- **≥1 stamp, not the full roster.** Spec §6.3.
- **Stage 2 exit 2 recovery is a session restart**, because the MCP path has no per-command escape. Spec §10.
