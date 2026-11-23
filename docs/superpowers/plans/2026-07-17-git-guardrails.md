# Git Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically enforce worktree isolation (deny), inject fresh PR state before destructive git ops (warn), harden the `/todo` branch sweep, and make scope-contract violations blocking review findings.

**Architecture:** A session-keyed **registry directory** (`/tmp/claude-worktree-contracts-<session_id>/`, one file per declared worktree) is written by `scripts/declare-worktree.sh` and read by two PreToolUse hooks: a rewritten `guard-worktree-isolation.sh` (Edit/Write/MultiEdit/NotebookEdit) and a new combined `git-safety.sh` (Bash: contract-deny branch + warn-only destructive-op advisor). All subagents share the parent's session ID (verified 2026-07-17), so the registry is additive per-worktree — never a single last-write-wins slot. Skill/agent docs wire declaration into `/todo`, `/todo-fast`, and the executor; scope contracts land in the todo template and review tier rules.

**Tech Stack:** Bash hooks (jq), Bash hook self-tests (`.claude/hooks/test-*.sh`, discovered by `scripts/run-hook-tests.sh`), Vitest shell-out tests for `scripts/*.sh` (precedent: `scripts/__tests__/todo-automerge-guard.test.ts`).

**Spec:** `docs/superpowers/specs/2026-07-17-git-guardrails-design.md` (approved). Two implementation refinements to the spec are deliberate and get synced back into the spec in Task 9:

1. An **unparseable hook-input envelope** falls through to fallback mode (fail open) — with garbage JSON the session ID is unknowable, so registry state can't be determined; fail-closed applies only once a registry is identifiable (malformed _entries_, missing `file_path` while a registry is active, missing `jq` in the file-tool guard).
2. The Bash **write-shaped-command deny is scoped to targets under the main checkout** (not "anywhere outside every worktree") — this targets the actual incident (writes into the main checkout) and avoids false positives on `/var/folders` temp paths, other repos, etc. Mutating-git commands keep the broader any-outside-registered rule with an allowlist.

## Global Constraints

- **Branch:** all work on feature branch `git-guardrails` off `main`. NEVER commit to `main` (branch protection: `enforce_admins: true`, 8 required checks).
- **TDD:** every script/hook task writes its failing test first, runs it red, implements, runs it green, then commits.
- **Registry path (exact, used everywhere):** `/tmp/claude-worktree-contracts-${SESSION_ID}/` — entry filename = first 16 hex chars of `shasum` of the absolute worktree path; entry content = that absolute path, no trailing newline.
- **Allowlist (file-tool guard + mutating-git branch):** `/tmp/*`, `/private/tmp/*`, `/var/folders/*`, `/private/var/folders/*`, `$HOME/.claude/*`.
- **Bypass env var:** `SKIP_WORKTREE_CONTRACT=1` (house pattern, like `SKIP_PR_PREFLIGHT`).
- **Hook output shapes (exact):**
  - Deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}`
  - Warn: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"..."}}`
  - Allow: **no output at all**, exit 0.
- **Hook latency budget:** ~140 ms per Bash hook is the measured overhead ceiling; non-matching commands must exit via cheap greps/stats before any `git`/`gh` subprocess.
- **Advisor never blocks** (user decision). Contract checks deny.
- **Hook self-tests** are plain Bash `test-<hookname>.sh` files beside the hook — `scripts/run-hook-tests.sh` auto-discovers the glob; CI runs it as "Hook self-tests". Vitest is ONLY for `scripts/*.sh`.
- **Commit trailer:** end every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `docs/superpowers/**` is gitignored — spec/plan edits are local-only, never staged.

---

### Task 1: `scripts/declare-worktree.sh` + Vitest test

**Files:**

- Create: `scripts/declare-worktree.sh`
- Test: `scripts/__tests__/declare-worktree.test.ts`

**Interfaces:**

- Consumes: `CLAUDE_CODE_SESSION_ID` env var (errors if unset).
- Produces (later tasks rely on these exact behaviors):
  - `bash scripts/declare-worktree.sh <abs-path>` → exit 0, writes registry entry; idempotent.
  - `bash scripts/declare-worktree.sh --remove <abs-path>` → exit 0, removes that entry (no error if absent).
  - `bash scripts/declare-worktree.sh --clear` → exit 0, removes the whole registry dir.
  - Refusals (exit 1): relative path, nonexistent dir, not a git dir, **the main checkout** (declaring it would neuter the guard), a non-root subdirectory of a worktree. Exit 2: bad usage.

- [ ] **Step 1: Create the branch**

```bash
git switch main && git pull --ff-only && git switch -c git-guardrails
```

- [ ] **Step 2: Write the failing test**

Create `scripts/__tests__/declare-worktree.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const SCRIPT = join(__dirname, "..", "declare-worktree.sh");
const SESSION = `test-declare-${process.pid}`;
const REG_DIR = `/tmp/claude-worktree-contracts-${SESSION}`;

function keyFor(absPath: string): string {
  // Mirrors the script: first 16 hex chars of `shasum` (SHA-1) of the path.
  return createHash("sha1").update(absPath).digest("hex").slice(0, 16);
}

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CODE_SESSION_ID: SESSION, ...env },
  });
}

let repo: string;
let worktree: string;

beforeEach(() => {
  // realpathSync: macOS tmpdir() is /var/folders/... (a symlink to /private/var/...);
  // git reports PHYSICAL paths, and the script compares them literally.
  repo = realpathSync(mkdtempSync(join(tmpdir(), "declare-wt-")));
  const git = (args: string[], cwd = repo) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_DIR: undefined as never },
    });
  git(["init", "-q"]);
  git([
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "--allow-empty",
    "-q",
    "-m",
    "init",
  ]);
  worktree = join(repo, "wt-a");
  git(["worktree", "add", "-q", worktree]);
});

afterEach(() => {
  rmSync(REG_DIR, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe("declare-worktree.sh", () => {
  it("declares a linked worktree: registry entry holds the path", () => {
    const r = run([worktree]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(REG_DIR, keyFor(worktree)), "utf8")).toBe(
      worktree,
    );
  });

  it("is idempotent: declaring twice leaves one entry", () => {
    run([worktree]);
    run([worktree]);
    expect(readdirSync(REG_DIR)).toHaveLength(1);
  });

  it("coexists: declaring a second worktree adds a second entry", () => {
    const wtB = join(repo, "wt-b");
    execFileSync("git", ["worktree", "add", "-q", wtB], { cwd: repo });
    run([worktree]);
    run([wtB]);
    expect(readdirSync(REG_DIR).sort()).toEqual(
      [keyFor(worktree), keyFor(wtB)].sort(),
    );
  });

  it("--remove deletes only that entry", () => {
    const wtB = join(repo, "wt-b");
    execFileSync("git", ["worktree", "add", "-q", wtB], { cwd: repo });
    run([worktree]);
    run([wtB]);
    const r = run(["--remove", worktree]);
    expect(r.status).toBe(0);
    expect(readdirSync(REG_DIR)).toEqual([keyFor(wtB)]);
  });

  it("--clear removes the registry directory", () => {
    run([worktree]);
    const r = run(["--clear"]);
    expect(r.status).toBe(0);
    expect(existsSync(REG_DIR)).toBe(false);
  });

  it("refuses a relative path", () => {
    const r = run(["some/relative/path"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("absolute");
  });

  it("refuses the main checkout", () => {
    const r = run([repo]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("main checkout");
  });

  it("refuses a directory that is not a worktree root", () => {
    const r = run([join(worktree, "..")]); // resolves oddly — use a real subdir instead
    // Simpler concrete case: a subdirectory of the worktree.
    execFileSync("mkdir", ["-p", join(worktree, "sub")]);
    const r2 = run([join(worktree, "sub")]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("not a worktree root");
    expect(r.status).not.toBe(0);
  });

  it("errors when CLAUDE_CODE_SESSION_ID is unset", () => {
    const r = spawnSync("bash", [SCRIPT, worktree], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: "" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("CLAUDE_CODE_SESSION_ID");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run scripts/__tests__/declare-worktree.test.ts`
Expected: FAIL — every test errors because `scripts/declare-worktree.sh` does not exist.

- [ ] **Step 4: Write the implementation**

Create `scripts/declare-worktree.sh` (make executable: `chmod +x`):

```bash
#!/usr/bin/env bash
# scripts/declare-worktree.sh — manage the session's worktree-contract registry.
#
# Registry: /tmp/claude-worktree-contracts-$CLAUDE_CODE_SESSION_ID/<key>
#   <key>  = first 16 hex chars of shasum(abs worktree path)
#   content = the absolute worktree path (no trailing newline)
#
# While the registry is non-empty, .claude/hooks/guard-worktree-isolation.sh and
# .claude/hooks/git-safety.sh DENY mutating operations outside every registered
# worktree. All subagents share the parent session's CLAUDE_CODE_SESSION_ID
# (verified 2026-07-17), so entries from parallel executors coexist — the registry
# is additive, never a single last-write-wins slot.
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1.
# Tests: scripts/__tests__/declare-worktree.test.ts
set -euo pipefail

usage() {
  echo "usage: declare-worktree.sh <abs-worktree-path> | --remove <abs-worktree-path> | --clear" >&2
  exit 2
}

SESSION="${CLAUDE_CODE_SESSION_ID:-}"
if [ -z "$SESSION" ]; then
  echo "declare-worktree: CLAUDE_CODE_SESSION_ID is not set — cannot key the registry" >&2
  exit 1
fi
REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"

key_for() { printf '%s' "$1" | shasum | cut -c1-16; }

case "${1:-}" in
  --clear)
    rm -rf "$REG_DIR"
    echo "cleared worktree-contract registry: $REG_DIR"
    ;;
  --remove)
    P="${2:-}"
    [ -n "$P" ] || usage
    rm -f "$REG_DIR/$(key_for "$P")"
    echo "removed worktree contract: $P"
    ;;
  --*|"")
    usage
    ;;
  *)
    P="$1"
    case "$P" in
      /*) ;;
      *) echo "declare-worktree: path must be absolute: $P" >&2; exit 1 ;;
    esac
    [ -d "$P" ] || { echo "declare-worktree: no such directory: $P" >&2; exit 1; }
    GIT_DIR_P=$(git -C "$P" rev-parse --path-format=absolute --git-dir 2>/dev/null) \
      || { echo "declare-worktree: not inside a git repository: $P" >&2; exit 1; }
    COMMON_P=$(git -C "$P" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) \
      || { echo "declare-worktree: cannot resolve git common dir: $P" >&2; exit 1; }
    # A linked worktree's git-dir differs from the common dir; the main checkout's
    # doesn't. Registering the main checkout would neuter the guard (it would become
    # an allowed write target) — refuse it.
    if [ "$GIT_DIR_P" = "$COMMON_P" ]; then
      echo "declare-worktree: $P is the main checkout, not a linked worktree — refusing to register it" >&2
      exit 1
    fi
    TOP=$(git -C "$P" rev-parse --show-toplevel)
    if [ "$TOP" != "$P" ]; then
      echo "declare-worktree: $P is not a worktree root (root is $TOP)" >&2
      exit 1
    fi
    mkdir -p "$REG_DIR"
    printf '%s' "$P" > "$REG_DIR/$(key_for "$P")"
    echo "declared worktree: $P"
    ;;
esac
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/declare-worktree.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/declare-worktree.sh scripts/__tests__/declare-worktree.test.ts
git commit -m "feat(guardrails): worktree-contract registry declare script"
```

---

### Task 2: `scripts/verify-branch-merged.sh` + Vitest test

**Files:**

- Create: `scripts/verify-branch-merged.sh`
- Test: `scripts/__tests__/verify-branch-merged.test.ts`

**Interfaces:**

- Produces: `bash scripts/verify-branch-merged.sh <branch>` → exit 0 **only** when `gh pr view <branch> --json state -q .state` freshly returns `MERGED`. Any other state, no PR, or `gh` failure → exit 1 (fail-closed). Missing arg → exit 2. Task 6's sweep edit calls it with exactly this contract.

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/verify-branch-merged.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "verify-branch-merged.sh");

// Fake `gh` controlled by env: FAKE_GH_STATE (echoed), FAKE_GH_EXIT (exit code).
const FAKE_GH = `#!/usr/bin/env bash
if [ "\${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "\${FAKE_GH_STDERR:-no pull requests found for branch}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '%s\\n' "$FAKE_GH_STATE"
exit 0
`;

let tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

function run(branch: string[], env: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "gh"), FAKE_GH);
  chmodSync(join(dir, "gh"), 0o755);
  return spawnSync("bash", [SCRIPT, ...branch], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, ...env },
  });
}

describe("verify-branch-merged.sh", () => {
  it("exit 0 when the fresh PR state is MERGED", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "MERGED" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MERGED");
  });

  it("exit 1 when the PR is OPEN", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "OPEN" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 when the PR is CLOSED without merge", () => {
    expect(run(["todo/foo"], { FAKE_GH_STATE: "CLOSED" }).status).toBe(1);
  });

  it("exit 1 when no PR exists (gh non-zero)", () => {
    const r = run(["todo/foo"], { FAKE_GH_STATE: "", FAKE_GH_EXIT: "1" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("NOT safe to delete");
  });

  it("exit 1 on a hard gh failure (fail-closed)", () => {
    expect(
      run(["todo/foo"], {
        FAKE_GH_STATE: "",
        FAKE_GH_EXIT: "8",
        FAKE_GH_STDERR: "network down",
      }).status,
    ).toBe(1);
  });

  it("exit 2 with no argument", () => {
    expect(run([], { FAKE_GH_STATE: "MERGED" }).status).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/__tests__/verify-branch-merged.test.ts`
Expected: FAIL — script does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/verify-branch-merged.sh` (chmod +x):

```bash
#!/usr/bin/env bash
# scripts/verify-branch-merged.sh <branch> — exit 0 ONLY if the branch's PR state
# is MERGED at a FRESH gh read. Fail-closed: any other state, no PR, or gh failure
# → exit 1. Called by /todo Phase 0 immediately before EACH branch deletion — the
# batch snapshot selects candidates, this gates the actual delete (a snapshot can
# go stale mid-run: the PR #520 incident class).
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.3.
# Tests: scripts/__tests__/verify-branch-merged.test.ts
set -uo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: verify-branch-merged.sh <branch>" >&2
  exit 2
fi

if ! STATE=$(gh pr view "$BRANCH" --json state -q .state 2>/dev/null); then
  echo "verify-branch-merged: no PR found or gh failed for '$BRANCH' — NOT safe to delete" >&2
  exit 1
fi

if [ "$STATE" = "MERGED" ]; then
  echo "verify-branch-merged: '$BRANCH' is MERGED — safe to delete"
  exit 0
fi

echo "verify-branch-merged: '$BRANCH' PR state is '$STATE' (not MERGED) — NOT safe to delete" >&2
exit 1
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/verify-branch-merged.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-branch-merged.sh scripts/__tests__/verify-branch-merged.test.ts
git commit -m "feat(guardrails): fail-closed fresh merged-state check for branch deletion"
```

---

### Task 3: Rewrite `guard-worktree-isolation.sh` (registry mode + nested-worktree fix)

**Files:**

- Modify: `.claude/hooks/guard-worktree-isolation.sh` (full rewrite, current file is 54 lines)
- Modify: `.claude/hooks/test-guard-worktree-isolation.sh` (extend; keep existing helpers)

**Interfaces:**

- Consumes: registry entries written by Task 1's script (reads them directly off disk — the hook never shells out to the script).
- Produces: deny/allow behavior for Edit/Write/MultiEdit/NotebookEdit that Task 4's settings wiring registers for NotebookEdit.

- [ ] **Step 1: Extend the test file (failing first)**

In `.claude/hooks/test-guard-worktree-isolation.sh`, keep lines 1–66 (helpers + existing cases) as they are, **replace** the malformed-JSON case (lines 68–70) and **append** the new suites before the results footer (lines 72–74). The full new content from line 60 down:

```bash
# Allowed: absolute path entirely outside the repo (e.g. /tmp scratch files).
assert_allow "absolute path outside the repo is allowed" \
  "{\"cwd\":\"$WT\",\"tool_input\":{\"file_path\":\"/tmp/scratch.txt\"}}"

# Fail open: empty MAIN_ROOT (repo at filesystem root) must not deny everything.
assert_allow "empty MAIN_ROOT edge case fails open" \
  '{"cwd":"/.claude/worktrees/agent-abc","tool_input":{"file_path":"/etc/passwd"}}'

# Fail open: malformed JSON envelope — the session (and thus registry) is
# unknowable, so this falls through to fallback mode and allows.
assert_allow "malformed JSON envelope fails open (fallback mode)" \
  'not json at all'

# ---------- REGISTRY MODE ----------
SESSION="test-guard-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
WT_A='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
WT_B='/Users/x/projects/OCRecipes/.claude/worktrees/agent-bbb'
MAIN='/Users/x/projects/OCRecipes'
cleanup_registry() { rm -rf "$REG_DIR"; }
trap cleanup_registry EXIT
mkdir -p "$REG_DIR"
printf '%s' "$WT_A" > "$REG_DIR/aaaa000000000001"
printf '%s' "$WT_B" > "$REG_DIR/bbbb000000000002"

# THE incident: cwd is the main checkout while an assignment is active.
assert_deny "registry: main-checkout write while assignment active is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$MAIN/server/app.ts\"}}"

assert_deny "registry: RELATIVE path resolving into the main checkout is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"server/app.ts\"}}"

assert_allow "registry: write inside worktree A is allowed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"$WT_A/server/app.ts\"}}"

# Concurrency: entry B must not poison agent A's legitimate writes, and vice versa.
assert_allow "registry: concurrent worktree B write is allowed (no cross-contamination)" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_B\",\"tool_input\":{\"file_path\":\"$WT_B/client/App.tsx\"}}"

assert_allow "registry: relative path inside a registered worktree is allowed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"server/app.ts\"}}"

assert_allow "registry: /tmp allowlist" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"/tmp/scratch.txt\"}}"

assert_allow "registry: ~/.claude allowlist" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$HOME/.claude/plans/x.md\"}}"

# NotebookEdit uses notebook_path — must be covered too.
assert_deny "registry: notebook_path into the main checkout is denied" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"notebook_path\":\"$MAIN/analysis.ipynb\"}}"

# Malformed entry (relative content) → fail closed.
printf '%s' 'not-absolute' > "$REG_DIR/cccc000000000003"
assert_deny "registry: malformed entry fails closed" \
  "{\"session_id\":\"$SESSION\",\"cwd\":\"$WT_A\",\"tool_input\":{\"file_path\":\"$WT_A/server/app.ts\"}}"
rm -f "$REG_DIR/cccc000000000003"

# Bypass.
out=$(echo "{\"session_id\":\"$SESSION\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$MAIN/server/app.ts\"}}" \
  | SKIP_WORKTREE_CONTRACT=1 bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: SKIP_WORKTREE_CONTRACT=1 bypasses"; PASS=$((PASS+1));
else echo "FAIL: SKIP_WORKTREE_CONTRACT=1 bypasses"; FAIL=$((FAIL+1)); fi

cleanup_registry

# ---------- FALLBACK MODE: nested-worktree fixture (real git) ----------
# A worktree nested inside another worktree defeated the old sed path math
# (MAIN_ROOT resolved to the OUTER worktree, so a main-checkout write was allowed).
# The --git-common-dir derivation must deny it.
# pwd -P: use the PHYSICAL path — macOS mktemp returns /var/folders/... (symlinked),
# but git reports /private/var/..., and the hook compares prefixes literally.
NEST_TMP=$(cd "$(mktemp -d)" && pwd -P)
trap 'cleanup_registry; rm -rf "$NEST_TMP"' EXIT
(
  cd "$NEST_TMP"
  git init -q main
  cd main
  git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init
  git worktree add -q ".claude/worktrees/agent-outer"
  cd ".claude/worktrees/agent-outer"
  git worktree add -q ".claude/worktrees/agent-inner"   # relative path → nests on disk
) >/dev/null 2>&1
NEST_MAIN="$NEST_TMP/main"
NEST_INNER="$NEST_MAIN/.claude/worktrees/agent-outer/.claude/worktrees/agent-inner"
assert_deny "fallback: nested worktree cannot write to the TRUE main checkout" \
  "{\"cwd\":\"$NEST_INNER\",\"tool_input\":{\"file_path\":\"$NEST_MAIN/server/app.ts\"}}"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

- [ ] **Step 2: Run the test to verify the new cases fail**

Run: `bash .claude/hooks/test-guard-worktree-isolation.sh`
Expected: legacy cases PASS; every `registry:` case and the nested-worktree case FAIL (old hook has no registry mode and the sed math misses the nested case).

- [ ] **Step 3: Rewrite the hook**

Replace the full content of `.claude/hooks/guard-worktree-isolation.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse hook — worktree isolation for file-editing tools
# (Edit / Write / MultiEdit / NotebookEdit — see settings.json).
#
# Two modes:
#  1) REGISTRY MODE (primary): when /tmp/claude-worktree-contracts-<session_id>/
#     is non-empty (written by scripts/declare-worktree.sh), every edit must
#     resolve inside ONE of the registered worktrees, or the allowlist
#     (/tmp, /var/folders, ~/.claude) — DENY otherwise. This catches the
#     wrong-checkout incident: writes into the main checkout while a worktree
#     assignment is active. Relative paths resolve against the session cwd.
#     Fail direction: CLOSED (malformed entries / missing fields → deny).
#  2) FALLBACK MODE (no registry): legacy cwd-based escape detection — session
#     cwd inside .claude/worktrees/agent-*, absolute path under the main
#     checkout denied. MAIN_ROOT now derives from `git rev-parse
#     --git-common-dir` (nested-worktree-safe); the old sed math is the last
#     resort for non-repo paths. Fail direction: OPEN (legacy).
#
# Bypass: SKIP_WORKTREE_CONTRACT=1.
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1.
# Tests: .claude/hooks/test-guard-worktree-isolation.sh
set -uo pipefail

[ -n "${SKIP_WORKTREE_CONTRACT:-}" ] && exit 0

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}

# Without jq we cannot check an active registry — that must not silently disable
# isolation, so fail closed (hand-built JSON since jq is what's missing).
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"guard-worktree-isolation: jq unavailable - failing closed. Bypass: SKIP_WORKTREE_CONTRACT=1."}}'
  exit 0
fi

INPUT=$(cat)
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null || echo "")

REG_DIR=""
[ -n "$SESSION" ] && REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"

if [ -n "$REG_DIR" ] && [ -d "$REG_DIR" ] && [ -n "$(ls -A "$REG_DIR" 2>/dev/null)" ]; then
  # ---------- REGISTRY MODE (fail closed) ----------
  [ -n "$FILE_PATH" ] || deny "guard-worktree-isolation: could not read file_path/notebook_path from hook input while a worktree contract is active — failing closed. Bypass: SKIP_WORKTREE_CONTRACT=1."
  case "$FILE_PATH" in
    /*) RESOLVED="$FILE_PATH" ;;
    *)
      [ -n "$CWD" ] || deny "guard-worktree-isolation: relative path with unknown cwd while a worktree contract is active — failing closed."
      RESOLVED="$CWD/$FILE_PATH"
      ;;
  esac
  # Scratch + harness state stays writable from anywhere.
  case "$RESOLVED" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) exit 0 ;;
  esac
  REGISTERED=""
  for entry in "$REG_DIR"/*; do
    WT=$(cat "$entry" 2>/dev/null || echo "")
    case "$WT" in
      /*) ;;
      *) deny "guard-worktree-isolation: malformed registry entry $entry — failing closed. Re-declare with scripts/declare-worktree.sh, or bypass with SKIP_WORKTREE_CONTRACT=1." ;;
    esac
    REGISTERED="${REGISTERED}
  ${WT}"
    case "$RESOLVED" in
      "$WT"|"$WT"/*) exit 0 ;;   # inside a registered worktree — allowed
    esac
  done
  deny "Worktree contract violation: this session has active worktree assignment(s):${REGISTERED}
but the edit targets ${RESOLVED} — outside every registered worktree. Re-issue it under the assigned worktree. Escapes: SKIP_WORKTREE_CONTRACT=1 (one command) or scripts/declare-worktree.sh --remove/--clear (assignment ended)."
fi

# ---------- FALLBACK MODE (no registry; fail open — legacy behavior) ----------
[ -n "$CWD" ] || exit 0
[ -n "$FILE_PATH" ] || exit 0

case "$CWD" in
  */.claude/worktrees/agent-*) ;;
  *) exit 0 ;;
esac

# Worktree root = cwd truncated at (and including) the agent-<id> path component.
WT_ROOT=$(printf '%s' "$CWD" | sed -E 's#(.*/\.claude/worktrees/agent-[^/]+).*#\1#')
# Main repo root: ask git (nested-worktree-safe — the common dir always lives in
# the TRUE main checkout); fall back to the sed derivation (single-level only)
# when git can't answer, e.g. for the fake paths in unit tests.
MAIN_ROOT=""
COMMON=$(git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
[ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
[ -n "$MAIN_ROOT" ] || MAIN_ROOT="${WT_ROOT%/.claude/worktrees/agent-*}"
[ -n "$MAIN_ROOT" ] || exit 0

# Relative file_path resolves against cwd (inside the worktree) — always safe.
case "$FILE_PATH" in
  /*) ;;
  *) exit 0 ;;
esac

case "$FILE_PATH" in
  "$WT_ROOT"|"$WT_ROOT"/*) exit 0 ;;   # inside the worktree — allowed
  "$MAIN_ROOT"/*) ;;                   # under main repo, outside worktree — the leak
  *) exit 0 ;;                         # entirely outside the repo — allowed
esac

deny "Worktree isolation guard: this session is running inside the agent worktree
  $WT_ROOT
but the edit targets the absolute path $FILE_PATH under the main checkout. Re-issue the edit with a worktree-rooted path (under the worktree directory above)."
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-guard-worktree-isolation.sh`
Expected: `Results: N passed, 0 failed` (all legacy + registry + nested cases).

Also run the whole suite to catch regressions in other hooks' tests: `bash scripts/run-hook-tests.sh`
Expected: `✓ 28 hook self-tests passed` (same count as before — no new test files yet).

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/guard-worktree-isolation.sh .claude/hooks/test-guard-worktree-isolation.sh
git commit -m "feat(guardrails): registry-mode worktree guard + nested-worktree main-root fix"
```

---

### Task 4: `.claude/hooks/git-safety.sh` + settings wiring

**Files:**

- Create: `.claude/hooks/git-safety.sh`
- Create: `.claude/hooks/test-git-safety.sh`
- Modify: `.claude/settings.json` (two additions)

**Interfaces:**

- Consumes: the registry (Task 1 format), the deny/warn JSON shapes (Global Constraints).
- Produces: PreToolUse(Bash) behavior — contract denies + advisor warnings — that Tasks 6–8 reference in skill/agent prose.

- [ ] **Step 1: Write the failing test**

Create `.claude/hooks/test-git-safety.sh`:

```bash
#!/usr/bin/env bash
# Tests for git-safety.sh — run from anywhere. Uses a fake `gh` on PATH and a
# hand-built registry; real git only for the write-shape fixture.
set -uo pipefail

HOOK="$(cd "$(dirname "$0")" && pwd)/git-safety.sh"
PASS=0; FAIL=0

run_hook() { echo "$1" | bash "$HOOK" 2>/dev/null; }

assert_deny() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision": "deny"'; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected deny)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}
assert_allow() {
  local name="$1" out; out=$(run_hook "$2")
  if [ -z "$out" ]; then echo "PASS: $name"; PASS=$((PASS+1))
  else echo "FAIL: $name (expected no output)"; echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1)); fi
}
# Advisor must WARN (additionalContext containing $3) and must NOT deny.
assert_warn_contains() {
  local name="$1" out; out=$(run_hook "$2")
  if echo "$out" | grep -q '"permissionDecision"'; then
    echo "FAIL: $name (advisor must never block)"; FAIL=$((FAIL+1)); return
  fi
  if echo "$out" | grep -q '"additionalContext"' && echo "$out" | grep -qF "$3"; then
    echo "PASS: $name"; PASS=$((PASS+1))
  else
    echo "FAIL: $name (expected additionalContext containing: $3)"
    echo "  got: $(echo "$out" | head -3)"; FAIL=$((FAIL+1))
  fi
}

json() {  # $1=session $2=cwd $3=command
  printf '{"tool_name":"Bash","session_id":"%s","cwd":"%s","tool_input":{"command":"%s"}}' "$1" "$2" "$3"
}

# ---------- fake gh ----------
FAKE_BIN=$(mktemp -d)
cat > "$FAKE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ "${FAKE_GH_EXIT:-0}" != "0" ]; then
  echo "${FAKE_GH_STDERR:-no pull requests found}" >&2
  exit "$FAKE_GH_EXIT"
fi
printf '{"number":520,"state":"%s","mergedAt":"2026-07-16T00:00:00Z"}\n' "${FAKE_GH_STATE:-MERGED}"
exit 0
EOF
chmod +x "$FAKE_BIN/gh"
export PATH="$FAKE_BIN:$PATH"

# ---------- registry fixtures ----------
SESSION="test-gitsafety-$$"
REG_DIR="/tmp/claude-worktree-contracts-$SESSION"
WT_A='/Users/x/projects/OCRecipes/.claude/worktrees/agent-aaa'
MAIN='/Users/x/projects/OCRecipes'
mkdir -p "$REG_DIR"
printf '%s' "$WT_A" > "$REG_DIR/aaaa000000000001"
NEST_TMP=""
cleanup() { rm -rf "$REG_DIR" "$FAKE_BIN" ${NEST_TMP:+"$NEST_TMP"}; }
trap cleanup EXIT

# ---------- fast path / no-op ----------
assert_allow "plain command with no registry is silent" \
  "$(json no-registry-session "$MAIN" 'echo hi')"
assert_allow "mutating git with NO registry is allowed (fallback is the file guard's job)" \
  "$(json no-registry-session "$MAIN" 'git commit -m x')"

# ---------- contract branch: mutating git ----------
assert_deny "registry: git commit with main-checkout cwd is denied" \
  "$(json "$SESSION" "$MAIN" 'git commit -m x')"
assert_deny "registry: git mv with main-checkout cwd is denied (the incident)" \
  "$(json "$SESSION" "$MAIN" 'git mv a.ts b.ts')"
assert_allow "registry: git commit inside the registered worktree is allowed" \
  "$(json "$SESSION" "$WT_A" 'git commit -m x')"
assert_allow "registry: git -C <worktree> commit from main cwd is allowed" \
  "$(json "$SESSION" "$MAIN" "git -C $WT_A commit -m x")"
assert_deny "registry: git -C <main> commit from worktree cwd is denied" \
  "$(json "$SESSION" "$WT_A" "git -C $MAIN commit -m x")"
assert_allow "registry: read-only git anywhere is allowed" \
  "$(json "$SESSION" "$MAIN" 'git status && git diff HEAD')"
assert_allow "registry: git in /tmp scratch repo is allowlisted" \
  "$(json "$SESSION" '/tmp/scratch-repo' 'git commit -m probe')"

# Bypass.
out=$(echo "$(json "$SESSION" "$MAIN" 'git commit -m x')" | SKIP_WORKTREE_CONTRACT=1 bash "$HOOK" 2>/dev/null)
if [ -z "$out" ]; then echo "PASS: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; PASS=$((PASS+1));
else echo "FAIL: SKIP_WORKTREE_CONTRACT=1 bypasses contract branch"; FAIL=$((FAIL+1)); fi

# ---------- contract branch: write-shaped commands (real git for MAIN_ROOT) ----------
# pwd -P for the same macOS symlink reason as in test-guard-worktree-isolation.sh.
NEST_TMP=$(cd "$(mktemp -d)" && pwd -P)
(
  cd "$NEST_TMP"
  git init -q main && cd main
  git -c user.email=t@t -c user.name=t commit --allow-empty -q -m init
  git worktree add -q ".claude/worktrees/agent-real"
) >/dev/null 2>&1
R_MAIN="$NEST_TMP/main"
R_WT="$R_MAIN/.claude/worktrees/agent-real"
printf '%s' "$R_WT" > "$REG_DIR/dddd000000000004"

assert_deny "registry: redirect into the main checkout is denied" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_MAIN/notes.txt")"
assert_deny "registry: sed -i on a main-checkout file is denied" \
  "$(json "$SESSION" "$R_WT" "sed -i '' s/a/b/ $R_MAIN/server/app.ts")"
assert_allow "registry: redirect inside the registered worktree is allowed" \
  "$(json "$SESSION" "$R_WT" "echo x > $R_WT/notes.txt")"
assert_allow "registry: redirect to /tmp is allowed" \
  "$(json "$SESSION" "$R_WT" 'echo x > /tmp/scratch.txt')"
rm -f "$REG_DIR/dddd000000000004"

# ---------- advisor branch (fires with or without a registry) ----------
FAKE_GH_STATE=MERGED assert_warn_contains "advisor: branch -D with MERGED PR reports safe" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "MERGED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: branch -D with OPEN PR warns loudly" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "OPEN and NOT merged"
FAKE_GH_STATE=CLOSED assert_warn_contains "advisor: CLOSED-unmerged PR is a rejection signal" \
  "$(json no-registry-session "$MAIN" 'git push origin --delete todo/foo')" \
  "CLOSED WITHOUT MERGE"
FAKE_GH_EXIT=1 assert_warn_contains "advisor: no PR found warns about never-pushed work" \
  "$(json no-registry-session "$MAIN" 'git branch -D scratch-branch')" \
  "NO PR found"
FAKE_GH_EXIT=8 FAKE_GH_STDERR="network down" assert_warn_contains "advisor: gh hard failure reports UNVERIFIED" \
  "$(json no-registry-session "$MAIN" 'git branch -D todo/foo')" \
  "UNVERIFIED"
FAKE_GH_STATE=OPEN assert_warn_contains "advisor: gh pr close is matched" \
  "$(json no-registry-session "$MAIN" 'gh pr close 520')" \
  "OPEN and NOT merged"
assert_warn_contains "advisor: worktree remove --force warns about uncommitted work" \
  "$(json no-registry-session "$MAIN" 'git worktree remove --force .claude/worktrees/agent-x')" \
  "uncommitted"

# Non-destructive gh/git stays silent.
assert_allow "advisor: gh pr view is not matched" \
  "$(json no-registry-session "$MAIN" 'gh pr view 520')"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
```

Note on the env-prefixed assertions (`FAKE_GH_STATE=MERGED assert_warn_contains ...`): env prefixes on a shell **function** call apply to the function's environment in bash — this works because `run_hook` invokes the hook as a child `bash` which inherits them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash .claude/hooks/test-git-safety.sh`
Expected: FAIL — `git-safety.sh` does not exist.

- [ ] **Step 3: Write the hook**

Create `.claude/hooks/git-safety.sh`:

```bash
#!/usr/bin/env bash
# PreToolUse(Bash) — combined git-safety hook. ONE Bash hook (respecting the
# ~140ms/hook budget), two branches:
#
#  A) CONTRACT branch (deny, fail closed) — active only while the session's
#     worktree-contract registry (/tmp/claude-worktree-contracts-<session_id>/,
#     written by scripts/declare-worktree.sh) is non-empty:
#       - mutating git subcommands (commit|mv|rm|restore|checkout|stash|reset|
#         rebase|merge|cherry-pick|apply|am|clean) whose EFFECTIVE repo (cwd, or
#         the `git -C <path>` override; relative -C resolves against cwd) is not
#         a registered worktree and not allowlisted → DENY.
#       - write-shaped shell commands (>/>> redirects, tee, rm, cp/mv destination,
#         sed -i) with an absolute target UNDER THE MAIN CHECKOUT and outside
#         every registered worktree → DENY. (Scoped to the main checkout — the
#         incident class — to avoid false positives elsewhere.)
#     Bypass: SKIP_WORKTREE_CONTRACT=1.
#
#  B) ADVISOR branch (warn only, NEVER blocks — user decision) — on destructive
#     ops (git branch -D, git push --delete/:ref, gh pr close, git worktree
#     remove --force): inject FRESH per-branch PR state as additionalContext so
#     the decision is made on live data, not a stale snapshot (the PR #520
#     incident). gh failure → "UNVERIFIED" warning, still allowed (fail open).
#
# Spec: docs/superpowers/specs/2026-07-17-git-guardrails-design.md §3.1–3.2.
# Tests: .claude/hooks/test-git-safety.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0   # cannot parse anything without jq; the file-tool guard still fails closed

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -re '.tool_name' 2>/dev/null) || exit 0
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(printf '%s' "$INPUT" | jq -re '.tool_input.command' 2>/dev/null) || exit 0
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")
SESSION=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")

deny() {
  jq -n --arg r "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$r}}'
  exit 0
}
warn() {
  jq -n --arg c "$1" \
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":$c}}'
  exit 0
}

REG_DIR=""
[ -n "$SESSION" ] && REG_DIR="/tmp/claude-worktree-contracts-${SESSION}"
registry_active() { [ -n "$REG_DIR" ] && [ -d "$REG_DIR" ] && [ -n "$(ls -A "$REG_DIR" 2>/dev/null)" ]; }

allowlisted() {
  case "$1" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*|"${HOME:-/nonexistent}"/.claude/*) return 0 ;;
    *) return 1 ;;
  esac
}
in_registered() {
  local p="$1" entry wt
  for entry in "$REG_DIR"/*; do
    wt=$(cat "$entry" 2>/dev/null || echo "")
    [ -n "$wt" ] || continue
    case "$p" in "$wt"|"$wt"/*) return 0 ;; esac
  done
  return 1
}
registered_list() { for e in "$REG_DIR"/*; do printf '  %s\n' "$(cat "$e" 2>/dev/null)"; done; }
ESCAPES="Escapes: SKIP_WORKTREE_CONTRACT=1 (one command) or scripts/declare-worktree.sh --remove/--clear (assignment ended)."

# ============ A) CONTRACT branch ============
MUTATING_GIT_RE='(^|&&|\|\||;)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*git([[:space:]]+-C[[:space:]]+[^[:space:]]+)?([[:space:]]+-c[[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|mv|rm|restore|checkout|stash|reset|rebase|merge|cherry-pick|apply|am|clean)([[:space:]]|$)'

if [ -z "${SKIP_WORKTREE_CONTRACT:-}" ] && registry_active; then
  # --- mutating git: effective repo must be a registered worktree (or allowlisted scratch) ---
  if printf '%s' "$CMD" | grep -qE "$MUTATING_GIT_RE"; then
    C_TARGET=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+"?([^"[:space:]]+)"?.*/\1/p' | head -1)
    EFFECTIVE="${C_TARGET:-$CWD}"
    case "$EFFECTIVE" in
      "") EFFECTIVE="$CWD" ;;
      /*) ;;
      *) EFFECTIVE=$( (cd "$CWD" 2>/dev/null && cd "$EFFECTIVE" 2>/dev/null && pwd) || printf '%s/%s' "$CWD" "$EFFECTIVE") ;;
    esac
    if [ -n "$EFFECTIVE" ] && ! allowlisted "$EFFECTIVE" && ! in_registered "$EFFECTIVE"; then
      deny "Worktree contract violation: a mutating git command would run against
  ${EFFECTIVE}
which is outside every registered worktree:
$(registered_list)
Run it inside the assigned worktree (or with git -C <worktree>). ${ESCAPES}"
    fi
  fi

  # --- write-shaped shell commands: absolute targets under the MAIN checkout ---
  MAIN_ROOT=""
  COMMON=$(git -C "${CWD:-/nonexistent}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
  [ -n "$COMMON" ] && MAIN_ROOT=$(dirname "$COMMON")
  if [ -n "$MAIN_ROOT" ]; then
    WRITE_TARGETS=$(
      {
        # >/>> redirect targets
        printf '%s' "$CMD" | grep -oE '>>?[[:space:]]*/[^[:space:]"'"'"';|&]+' | sed -E 's/^>>?[[:space:]]*//'
        # tee targets
        printf '%s' "$CMD" | grep -oE '(^|[[:space:]|;&])tee([[:space:]]+-[a-zA-Z]+)*[[:space:]]+/[^[:space:]"'"'"';|&]+' | grep -oE '/[^[:space:]"'"'"';|&]+$'
        # rm / sed -i: every absolute token; cp / mv: the trailing (destination) absolute token
        if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])(rm)[[:space:]]' || printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])sed[[:space:]][^|;]*-i'; then
          printf '%s\n' "$CMD" | tr ' ' '\n' | grep -E '^/' || true
        fi
        if printf '%s' "$CMD" | grep -qE '(^|[[:space:]|;&])(cp|mv)[[:space:]]'; then
          printf '%s\n' "$CMD" | tr ' ' '\n' | grep -E '^/' | tail -1 || true
        fi
      } | sort -u
    )
    while IFS= read -r t; do
      [ -n "$t" ] || continue
      allowlisted "$t" && continue
      in_registered "$t" && continue
      case "$t" in
        "$MAIN_ROOT"/*)
          deny "Worktree contract violation: a write-shaped command targets
  ${t}
under the main checkout while worktree assignment(s) are active:
$(registered_list)
${ESCAPES}" ;;
      esac
    done <<EOF
$WRITE_TARGETS
EOF
  fi
fi

# ============ B) ADVISOR branch (never blocks) ============
KIND=""
REF=""
if printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*git[[:space:]]+branch[[:space:]]+-[a-zA-Z]*D[a-zA-Z]*[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*--delete[[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*--delete[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+push[[:space:]][^;&|]*[[:space:]]:[^[:space:]]'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*[[:space:]]:([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+close[[:space:]]+'; then
  KIND="delete"
  REF=$(printf '%s' "$CMD" | sed -nE 's/.*gh[[:space:]]+pr[[:space:]]+close[[:space:]]+([^[:space:];&|]+).*/\1/p')
elif printf '%s' "$CMD" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+worktree[[:space:]]+remove[[:space:]][^;&|]*(--force|[[:space:]]-f)'; then
  warn "⚠ git worktree remove --force discards any uncommitted work in that worktree. Confirm the branch is pushed (or its PR merged) before removal. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md"
fi

if [ "$KIND" = "delete" ] && [ -n "$REF" ]; then
  REF="${REF#origin/}"
  if PR_JSON=$(gh pr view "$REF" --json number,state,mergedAt 2>/dev/null); then
    NUM=$(printf '%s' "$PR_JSON" | jq -r '.number' 2>/dev/null || echo "?")
    STATE=$(printf '%s' "$PR_JSON" | jq -r '.state' 2>/dev/null || echo "")
    MERGED_AT=$(printf '%s' "$PR_JSON" | jq -r '.mergedAt // "-"' 2>/dev/null || echo "-")
    case "$STATE" in
      MERGED) warn "Fresh PR check: PR #${NUM} for '${REF}' is MERGED (${MERGED_AT}) — deletion is safe." ;;
      OPEN)   warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is OPEN and NOT merged — deleting this branch will CLOSE THE PR UNMERGED (the PR #520 incident). Stop unless you intend to abandon it. Recovery runbook: docs/solutions/best-practices/restore-and-merge-closed-pr-after-branch-deletion-2026-07-11.md" ;;
      CLOSED) warn "⚠ Fresh PR check: PR #${NUM} for '${REF}' is CLOSED WITHOUT MERGE — a rejection signal. Never sweep this branch silently (keep local AND remote; see the land skill's branch-sweep table)." ;;
      *)      warn "⚠ Fresh PR check for '${REF}': PR state unparseable — treat as UNVERIFIED and confirm merge state manually. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md" ;;
    esac
  else
    GH_ERR=$(gh pr view "$REF" --json number 2>&1 >/dev/null || true)
    if printf '%s' "$GH_ERR" | grep -qi 'no pull requests found'; then
      warn "⚠ Fresh PR check: NO PR found for '${REF}' — deleting it may lose never-pushed work. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    else
      warn "⚠ Fresh PR check for '${REF}' FAILED (gh unavailable/network) — treat as UNVERIFIED and confirm merge state manually before deleting. Rule: docs/solutions/conventions/delete-branch-only-after-confirming-pr-merged-2026-07-06.md"
    fi
  fi
fi

exit 0
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash .claude/hooks/test-git-safety.sh`
Expected: `Results: N passed, 0 failed`.

Then the full suite: `bash scripts/run-hook-tests.sh`
Expected: `✓ 29 hook self-tests passed` (28 + the new `test-git-safety.sh`; the glob auto-discovers it).

- [ ] **Step 5: Wire the hook + NotebookEdit matcher in `.claude/settings.json`**

Two edits inside the `"PreToolUse"` array:

1. After the `pr-preflight-guard.sh` mcp matcher line (`{ "matcher": "mcp__github__create_pull_request", ... "pr-preflight-guard.sh" ... }`), insert:

```json
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "bash .claude/hooks/git-safety.sh", "timeout": 15, "statusMessage": "Checking git safety..." }] },
```

2. After the third `guard-worktree-isolation.sh` block (the one with `"matcher": "MultiEdit"`), insert:

```json
      {
        "matcher": "NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/guard-worktree-isolation.sh",
            "timeout": 10,
            "statusMessage": "Checking worktree isolation..."
          }
        ]
      },
```

Validate: `jq . .claude/settings.json >/dev/null && echo OK` → `OK`.

- [ ] **Step 6: Latency check (budget gate)**

```bash
time (echo '{"tool_name":"Bash","session_id":"none","cwd":"/tmp","tool_input":{"command":"echo hi"}}' | bash .claude/hooks/git-safety.sh)
```

Expected: real time well under 100ms (a couple of jq calls + greps; no git/gh on this path).

- [ ] **Step 7: Commit**

```bash
git add .claude/hooks/git-safety.sh .claude/hooks/test-git-safety.sh .claude/settings.json
git commit -m "feat(guardrails): combined Bash git-safety hook (contract deny + destructive-op advisor)"
```

---

### Task 5: SessionEnd registry cleanup + `branch-preflight.sh` comment fix

**Files:**

- Modify: `.claude/hooks/session-coord-hook.sh`
- Modify: `.claude/hooks/branch-preflight.sh:2-6` (comment only)

- [ ] **Step 1: Registry cleanup on deregister**

In `.claude/hooks/session-coord-hook.sh`, the current lines 13–14 are:

```bash
[ -f "$SCRIPT" ] || exit 0
INPUT=$(cat)
```

Replace with (INPUT must be read and cleanup must run even when the pg-lab script is absent):

```bash
INPUT=$(cat)
# SessionEnd: remove the session's worktree-contract registry (guardrails spec §3.1)
# BEFORE the pg-lab existence gate — cleanup must not depend on pg-lab being present.
if [ "$SUB" = "deregister" ] && command -v jq >/dev/null 2>&1; then
  SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
  [ -n "$SESSION_ID" ] && rm -rf "/tmp/claude-worktree-contracts-${SESSION_ID}"
fi
[ -f "$SCRIPT" ] || exit 0
```

- [ ] **Step 2: Fix the stale branch-preflight comment**

In `.claude/hooks/branch-preflight.sh`, replace lines 2–6:

```bash
# PreToolUse(Bash) — block git commit only when HEAD is detached.
# A detached-HEAD commit is unreachable (silent data loss), so we hard-block it.
# Committing on main/master is ALLOWED: enforce_admins is off, so the repo owner
# can push directly to main (branch protection no longer rejects owner pushes).
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
```

with:

```bash
# PreToolUse(Bash) — block git commit only when HEAD is detached.
# A detached-HEAD commit is unreachable (silent data loss), so we hard-block it.
# Committing on main/master locally is not blocked HERE, but pushing main is
# rejected by GitHub branch protection (enforce_admins: true, 8 required checks —
# verified live 2026-07-16). All work reaches main via PR.
# Escape: set SKIP_BRANCH_PREFLIGHT=1 in the shell that launched Claude Code.
```

- [ ] **Step 3: Verify nothing broke**

Run: `bash scripts/run-hook-tests.sh`
Expected: `✓ 29 hook self-tests passed`.

- [ ] **Step 4: Commit**

```bash
git add .claude/hooks/session-coord-hook.sh .claude/hooks/branch-preflight.sh
git commit -m "chore(guardrails): registry cleanup on session end; fix stale enforce_admins comment"
```

---

### Task 6: `/todo` skill — fresh per-branch delete gate + orchestrator `--clear`

**Files:**

- Modify: `.claude/skills/todo/SKILL.md` (Phase 0 code block, Phase 0 report item 3, Phase 5 opening)

- [ ] **Step 1: Gate the remote deletion loop**

In the Phase 0 code block, replace:

```bash
       if [ -s /tmp/todo-delete-branches.txt ]; then
         xargs git push origin --delete < /tmp/todo-delete-branches.txt
         git fetch --prune --quiet
       fi
```

with:

```bash
       if [ -s /tmp/todo-delete-branches.txt ]; then
         # The snapshot only SELECTS candidates. A FRESH per-branch check gates each
         # actual delete — the snapshot can go stale mid-run (the PR #520 incident
         # class: a branch merged-in-snapshot can have a new open PR by delete time).
         : > /tmp/todo-delete-skipped.txt
         while read -r b; do
           if bash scripts/verify-branch-merged.sh "$b"; then
             git push origin --delete "$b"
           else
             echo "$b" >> /tmp/todo-delete-skipped.txt
           fi
         done < /tmp/todo-delete-branches.txt
         git fetch --prune --quiet
       fi
```

- [ ] **Step 2: Gate the local deletion loop**

Replace:

```bash
       if [ -s /tmp/todo-delete-local-branches.txt ]; then
         while read -r b; do
           out=$(git branch -D "$b" 2>&1) && echo "deleted local branch: $b" \
             || { echo "$out" | grep -qE "checked out at|used by worktree at" || echo "WARNING: could not delete local branch $b: $out"; }
         done < /tmp/todo-delete-local-branches.txt
       fi
```

with:

```bash
       if [ -s /tmp/todo-delete-local-branches.txt ]; then
         while read -r b; do
           bash scripts/verify-branch-merged.sh "$b" \
             || { echo "$b" >> /tmp/todo-delete-skipped.txt; continue; }
           out=$(git branch -D "$b" 2>&1) && echo "deleted local branch: $b" \
             || { echo "$out" | grep -qE "checked out at|used by worktree at" || echo "WARNING: could not delete local branch $b: $out"; }
         done < /tmp/todo-delete-local-branches.txt
       fi
```

- [ ] **Step 3: Surface skipped deletions in the report item**

In Phase 0's step 3 (**Report**), the sentence listing attention files currently reads:

> If `/tmp/todo-closed-unmerged-branches.txt`, `/tmp/todo-local-closed-unmerged-branches.txt`, or `/tmp/todo-local-no-pr-branches.txt` is non-empty, or the sweep was skipped (gh failure or the `--limit` cap), carry that in orchestrator state — Phase 5 surfaces all of it.

Change the file list to include the new skip file:

> If `/tmp/todo-closed-unmerged-branches.txt`, `/tmp/todo-local-closed-unmerged-branches.txt`, `/tmp/todo-local-no-pr-branches.txt`, or `/tmp/todo-delete-skipped.txt` (branches whose FRESH merge-state check failed at delete time) is non-empty, or the sweep was skipped (gh failure or the `--limit` cap), carry that in orchestrator state — Phase 5 surfaces all of it.

- [ ] **Step 4: Orchestrator `--clear` before Phase 5**

Locate the `## Phase 5` heading in `.claude/skills/todo/SKILL.md` (grep `^## Phase 5`). Insert as the FIRST instruction under it:

> **First, release all worktree contracts:** run `bash scripts/declare-worktree.sh --clear`. Executors declare their worktrees at Step 0 and remove them at Step 11, but a crashed executor leaves a stale registry entry — and while ANY entry exists, the PreToolUse guards deny YOUR main-checkout git operations (reconciliation, archiving, branch cleanup). `--clear` is idempotent and safe here: all executors have returned by Phase 5.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/todo/SKILL.md
git commit -m "feat(guardrails): /todo sweep gates each delete on a fresh merged check; Phase 5 clears contracts"
```

---

### Task 7: `/todo-fast` skill — absolute worktree path + contract declaration

**Files:**

- Modify: `.claude/skills/todo-fast/SKILL.md` (Phase 1 code block at lines 58–64; implementer bullet at line 75; Cleanup section)

- [ ] **Step 1: Replace the Phase 1 creation block**

Replace (current lines 58–64):

```bash
SLUG="<todo filename minus .md>"
git worktree add ".claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"
WORKTREE="$(cd ".claude/worktrees/agent-todo-fast-$SLUG" && pwd)"
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
ln -sf "$MAIN_CHECKOUT/node_modules" "$WORKTREE/node_modules"
```

with:

```bash
SLUG="<todo filename minus .md>"
# ABSOLUTE destination, derived from the true main checkout — a relative path
# while cwd is already inside another worktree nests worktrees on disk, which
# defeated the isolation guard's path math (see the guardrails spec §3.3).
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
WORKTREE="$MAIN_CHECKOUT/.claude/worktrees/agent-todo-fast-$SLUG"
git worktree add "$WORKTREE" -b "todo/$SLUG" "$BASE_BRANCH"
ln -sf "$MAIN_CHECKOUT/node_modules" "$WORKTREE/node_modules"
# Register the worktree contract: while it exists, the PreToolUse guards DENY
# mutating operations outside this worktree (wrong-checkout protection).
bash scripts/declare-worktree.sh "$WORKTREE"
```

- [ ] **Step 2: Add declaration to the implementer dispatch contract**

In the `todo-fast-implementer` bullet (starts "**`todo-fast-implementer` agents (Phase 5):** the prompt's first instruction must be an explicit `cd "$WORKTREE"` ..."), append to the end of that bullet:

> Immediately after the `cd`, the prompt must also run `bash scripts/declare-worktree.sh "$WORKTREE"` — idempotent (all implementers share this one worktree), and it arms the registry-mode guards for the implementer's own tool calls, which the cwd-based fallback alone does not guarantee.

- [ ] **Step 3: Release the contract in Cleanup**

Locate the Cleanup section (grep `Cleanup` near the end of the file). Add one line to its worktree-removal step:

> Before `git worktree remove`, release the contract: `bash scripts/declare-worktree.sh --remove "$WORKTREE"` (a stale entry would deny subsequent main-checkout operations for the rest of the session).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/todo-fast/SKILL.md
git commit -m "feat(guardrails): todo-fast uses absolute worktree paths and declares contracts"
```

---

### Task 8: `todo-executor.md` — declare/release contract + scope-contract enforcement

**Files:**

- Modify: `.claude/agents/todo-executor.md` (Step 0, Step 4, Step 6, Step 11)

- [ ] **Step 1: Step 0 — declare after the pwd assertion**

After the bullet ending "…if you hit that denial, you used a main-rooted path — re-issue the edit against your worktree." (Step 0, line ~20), add a new bullet:

> - **Declare your worktree contract** so the PreToolUse guards enforce your isolation mechanically (not just by convention): `bash scripts/declare-worktree.sh "$(git rev-parse --show-toplevel)"`. This registers your worktree in the session's contract registry; entries from parallel executors coexist. You release it in Step 11 (`--remove`), and the orchestrator runs `--clear` as a crash backstop.

- [ ] **Step 2: Step 4 — scope-contract instruction**

In the Step 4 numbered list, after item 5 ("Keep changes minimal. …"), insert a new item 6 and renumber the current item 6 ("**Track all files you modify**…") to 7:

> 6. **Honor the todo's Scope Contract section** (when present) as a hard boundary: use ONLY the mechanisms it lists and touch ONLY files within its stated scope. Introducing a mechanism, file, or abstraction the contract excludes is a CRITICAL (blocking) review finding per `docs/AI_WORKFLOW.md` → Tier handling — it will block you at Step 6, so do not write it at Step 4.

- [ ] **Step 3: Step 6 — pass the contract to reviewers**

At the end of Step 6's item 3 (the dispatch-prompt paragraph ending "…see Step 5b for why."), append:

> If the todo carries a **Scope Contract** section, paste it verbatim into every reviewer prompt, appending: "Diff every added mechanism/file against this Scope Contract; anything it excludes is a CRITICAL finding."

- [ ] **Step 4: Step 11 — release the contract**

Immediately under the `## Step 11 — Report` heading, add as the first line:

> Before composing the report, release your worktree contract: `bash scripts/declare-worktree.sh --remove "$(git rev-parse --show-toplevel)"`. (The orchestrator's Phase 5 `--clear` is the backstop if you crash before this line.)

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/todo-executor.md
git commit -m "feat(guardrails): executor declares/releases worktree contract and enforces scope contracts"
```

---

### Task 9: Scope-contract docs + spec sync

**Files:**

- Modify: `todos/TEMPLATE.md` (new section after Implementation Notes)
- Modify: `docs/AI_WORKFLOW.md` (Tier handling)
- Modify: `.claude/agents/code-reviewer.md` (checklist item after the Minimal-changes item, line ~90)
- Modify (LOCAL ONLY, never staged): `docs/superpowers/specs/2026-07-17-git-guardrails-design.md`, `CLAUDE.md`

- [ ] **Step 1: Todo template**

In `todos/TEMPLATE.md`, after the `## Implementation Notes` section (its body line "Technical details, approach suggestions, or constraints to consider.") and before `## Dependencies`, insert:

```markdown
## Scope Contract

<!-- Optional but recommended. A stated contract is a HARD boundary: the executor must
     stay inside it, and reviewers treat violations as CRITICAL (blocking) findings —
     see docs/AI_WORKFLOW.md → Tier handling. Delete this section only if scope is
     genuinely open-ended. -->

- **Mechanisms to use:** <e.g. "the standard `blocked_until` frontmatter gate — nothing new">
- **Files in scope:** <exact paths or narrow globs>
- No new mechanisms, files, or abstractions beyond those listed.
```

- [ ] **Step 2: Tier rule in `docs/AI_WORKFLOW.md`**

In "Tier handling (project convention)", after the `**CRITICAL** blocks — must be fixed before the work proceeds.` bullet, insert:

```markdown
- **Scope-contract violation = CRITICAL.** When the task under review carries a stated Scope Contract (`todos/TEMPLATE.md` section), any added mechanism, file, or abstraction the contract excludes is treated as a correctness failure, not a style nit — it blocks like any other CRITICAL.
```

- [ ] **Step 3: code-reviewer checklist item**

In `.claude/agents/code-reviewer.md`, after the `**Minimal changes principle**` checklist item (line ~90), insert:

```markdown
- [ ] **Scope-contract compliance (when the task states one)** — enumerate every mechanism, new file, and abstraction the diff introduces and check each against the task's Scope Contract; anything the contract excludes is a **CRITICAL** finding (`docs/AI_WORKFLOW.md` → Tier handling), not a warning. Incident class: an extra date-stamp mechanism added when the todo asked for the standard `blocked_until` gate (PR #575).
```

- [ ] **Step 4: Sync the spec refinements (LOCAL file, do not stage)**

In `docs/superpowers/specs/2026-07-17-git-guardrails-design.md`:

1. §4 row "Hook JSON missing fields / no jq" → change the contract-guard cell to: "Unparseable envelope → fallback mode (session/registry unknowable). Once a registry is identifiable: missing `file_path`, malformed entries, or missing `jq` → deny (fail closed)".
2. §3.1 Bash write-shaped sentence: append "(targets are additionally scoped to the main checkout — absolute writes elsewhere are out of this guard's scope)".
3. §3.1 allowlist line: add `/var/folders` (macOS TMPDIR) to the allowlist.

- [ ] **Step 5: CLAUDE.md ad-hoc note (LOCAL file — gitignored, do not stage)**

In `CLAUDE.md`, in the "Workflow Standards" bullet list, append:

```markdown
- **Ad-hoc worktree sessions declare a contract:** after creating/entering a worktree outside `/todo`/`/todo-fast` (e.g. via `superpowers:using-git-worktrees`), run `bash scripts/declare-worktree.sh "$(git rev-parse --show-toplevel)"` — the PreToolUse guards then DENY mutating operations outside it (wrong-checkout protection). Release with `--remove`/`--clear` when done. Bypass one command with `SKIP_WORKTREE_CONTRACT=1`.
```

- [ ] **Step 6: Commit (tracked files only)**

```bash
git add todos/TEMPLATE.md docs/AI_WORKFLOW.md .claude/agents/code-reviewer.md
git status --porcelain   # confirm docs/superpowers/ and CLAUDE.md are NOT staged
git commit -m "feat(guardrails): scope contracts — todo template section, CRITICAL tier rule, reviewer check"
```

---

### Task 10: End-to-end verification, review, PR

**Files:** none new — verification and delivery.

- [ ] **Step 1: Full test pass**

```bash
bash scripts/run-hook-tests.sh
npx vitest run scripts/__tests__/declare-worktree.test.ts scripts/__tests__/verify-branch-merged.test.ts
```

Expected: `✓ 29 hook self-tests passed`; both Vitest files green.

- [ ] **Step 2: Manual smoke — two concurrent contracts (spec §6.2)**

```bash
# PHYSICAL paths (/private/tmp, not the /tmp symlink) — git reports physical paths
# and declare-worktree.sh compares them literally.
git worktree add /private/tmp/smoke-wt-a -b smoke/a && git worktree add /private/tmp/smoke-wt-b -b smoke/b
```

Note: `/private/tmp` worktrees are allowlisted for FILE writes, so exercise the guard with the real registry via hook-input simulation instead of live edits:

```bash
S="$CLAUDE_CODE_SESSION_ID"
bash scripts/declare-worktree.sh /private/tmp/smoke-wt-a
bash scripts/declare-worktree.sh /private/tmp/smoke-wt-b
MAIN=$(git rev-parse --show-toplevel)
# Expect DENY (main checkout write while assignments active):
echo "{\"session_id\":\"$S\",\"cwd\":\"$MAIN\",\"tool_input\":{\"file_path\":\"$MAIN/server/app.ts\"}}" | bash .claude/hooks/guard-worktree-isolation.sh
# Expect DENY (mutating git in main checkout):
echo "{\"tool_name\":\"Bash\",\"session_id\":\"$S\",\"cwd\":\"$MAIN\",\"tool_input\":{\"command\":\"git mv a b\"}}" | bash .claude/hooks/git-safety.sh
# Expect SILENT (worktree A op, no cross-contamination from B's entry):
echo "{\"tool_name\":\"Bash\",\"session_id\":\"$S\",\"cwd\":\"/private/tmp/smoke-wt-a\",\"tool_input\":{\"command\":\"git commit -m x\"}}" | bash .claude/hooks/git-safety.sh
# Expect an OPEN/NO-PR warning (fresh live gh call — use any branch that has an open PR, or observe the NO-PR message):
echo "{\"tool_name\":\"Bash\",\"session_id\":\"$S\",\"cwd\":\"$MAIN\",\"tool_input\":{\"command\":\"git branch -D smoke/a\"}}" | bash .claude/hooks/git-safety.sh
# Cleanup — clear contracts FIRST, then remove worktrees:
bash scripts/declare-worktree.sh --clear
git worktree remove --force /private/tmp/smoke-wt-a && git worktree remove --force /private/tmp/smoke-wt-b
git branch -D smoke/a smoke/b
```

- [ ] **Step 3: Code review (house policy — before PR)**

Dispatch per `docs/AI_WORKFLOW.md` → Review Policy: `code-reviewer` (baseline) + `security-auditor` (guard scripts gate git operations — fail-open/fail-closed logic is security-adjacent). Working-tree safety rules apply if run from a worktree. Fix CRITICALs; surface WARNINGs.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin git-guardrails
```

(The pre-push fast gate runs and stamps HEAD; PR creation requires that stamp.) Then create the PR via `mcp__github__create_pull_request` (title: "Git guardrails: worktree contract registry, destructive-op advisor, sweep hardening, scope contracts"), body summarizing the four components + test evidence, ending with the standard generated-with footer. `.claude/hooks/**` and `scripts/**` are automerge-HOLD paths — expect individual human review; do NOT arm auto-merge.

---

## Verification (plan-level)

1. All hook self-tests + both Vitest suites green (Task 10 Step 1).
2. Smoke matrix (Task 10 Step 2): main-checkout Edit and `git mv` denied under active contracts; sibling-worktree ops unaffected; destructive op yields a fresh-PR-state warning.
3. Latency: `git-safety.sh` early-exit path (Task 4 Step 6) under ~100 ms.
4. CI: 8 required checks green on the PR, including "Hook self-tests" now covering 29 files.
5. After merge: next `/todo` run exercises Phase 0's fresh delete gate and executor contract lifecycle in the wild — watch its Phase 5 report for `/tmp/todo-delete-skipped.txt` surfacing.
