# External Drive (U34Bolt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free ~46 GB of internal disk and keep it free by moving OCRecipes build output, ad-hoc worktrees and laptop-wide caches onto the U34Bolt SSD, with every redirect safe when the drive is unplugged.

**Architecture:** One repo deliverable (`scripts/oc-worktree.sh` + Vitest test + `.xcodebuildmcp/config.yaml` + `docs/DEV_SETUP.md` section) on branch `docs/external-drive-spec`; everything else is machine configuration (`~/.zshenv` block, an Xcode `defaults` key, the drive's README, global `~/.claude/CLAUDE.md`) and one-time removals. Every "is the drive there" decision uses one mount-point predicate (`df -P`), never a directory test.

**Tech Stack:** bash, zsh, Vitest (`spawnSync`), git worktrees, `diskutil`, `xcrun simctl`, XcodeBuildMCP 2.7.0, CocoaPods 1.17.0, Expo CLI.

**Spec:** `docs/superpowers/specs/2026-10-14-external-drive-design.md`

## Global Constraints

- Drive: `/Volumes/U34Bolt`, reformatted **APFS case-insensitive** (`diskutil` personality `APFS`, never `Case-sensitive APFS`).
- Mount predicate, used verbatim everywhere: `[ "$(df -P "$ROOT" 2>/dev/null | awk 'NR==2{print $6}')" = "$ROOT" ]`.
- Layout: `OCRecipes/{worktrees,build/xcodebuildmcp,tmp}`, `_shared/caches/{npm,cocoapods,DerivedData}`, `README.md`. Nothing else at the top level.
- Out of scope — do not touch: Devin, Flutter/Dart, Windsurf, `~/Library/Android` (SDK), `~/.gradle`, Android Studio, any other project folder, `<main>/.claude/worktrees/`, `.claude/hooks/**`, Postgres, Redis, `~/.claude`, the main checkout's location.
- `TMPDIR` is never exported globally.
- Owner-typed steps (via `!`): `diskutil eraseDisk`, every `sudo` command.
- `~/.zshenv` holds a GitHub PAT: never `cat`/`Read` it — append with a heredoc and check with `grep -c` on the marker only.
- Record `df -h /System/Volumes/Data` before and after every task; report measured deltas.
- Commit messages via Write + `git commit -F`; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Drive ejected while a tool still points at it** → nothing writes to the internal disk silently; a phantom `/Volumes/U34Bolt` triggers the shell warning. Pinned: Task 2 tests (plain dir / missing root refuse) and Task 6 Step 8 (phantom warning check).
2. **Branch names with `/` or spaces** (`feat/expo-cng-untrack`) → a flat, safe folder name. Pinned: Task 2 test "slugs".
3. **Destination folder already exists** (re-running after a failure) → refuse, never clobber. Pinned: Task 2 test "existing destination".
4. **Branch exists only on `origin`** (recreating `cng2` after the reformat) → checked out tracking `origin/<branch>`, not forked fresh from main. Pinned: Task 2 test "remote-only branch".
5. **Run outside a Claude session** (owner's own terminal) → worktree created, contract step skipped with a note, exit 0. Pinned: Task 2 test "no session".

---

### Task 1: Phase 0 relief (before anything else — 11 GB free is risky)

**Files:** none (machine only).

- [ ] **Step 1: Baseline**

Run: `df -h /System/Volumes/Data`
Then: `bash .claude/hooks/ledger-note.sh VERIFIED "baseline free space <N>Gi" "df -h /System/Volumes/Data"`

- [ ] **Step 2: List what is about to go**

```bash
du -sh ~/Library/Logs/* 2>/dev/null | sort -h | tail -10
du -sh ~/Library/Caches/* 2>/dev/null | sort -h | tail -10
ls ~/Library/Developer/XcodeBuildMCP/workspaces
```

From the Caches list, **skip** (do not delete): any `com.apple.*` entry, and any entry belonging to an app that is running now (`pgrep -fl "<App name>"`). Name to the owner any entry whose rebuild is a large re-download (e.g. `ms-playwright`, `Homebrew/downloads`) before deleting it.

- [ ] **Step 3: Delete**

```bash
rm -r ~/Library/Logs/* 2>/dev/null; true
rm -r ~/Library/Developer/XcodeBuildMCP/workspaces/*
# Caches: one rm per entry kept on the Step 2 list, e.g.
rm -r ~/Library/Caches/<entry>
```

- [ ] **Step 4: Measure**

Run: `df -h /System/Volumes/Data` — expect roughly +10–14 GB versus Step 1. Ledger-note the measured figure.

---

### Task 2: `scripts/oc-worktree.sh` (TDD)

**Files:**

- Create: `scripts/oc-worktree.sh` (mode 755)
- Test: `scripts/__tests__/oc-worktree.test.ts`

**Interfaces:**

- Produces: `bash scripts/oc-worktree.sh <branch> [<base>]` → prints the absolute worktree path on its last stdout line, exit 0. Exit 1 = refused (not mounted / destination exists); exit 2 = usage.
- Env: `OC_DRIVE_ROOT` (default `/Volumes/U34Bolt`), `OC_WORKTREES_DIR` (default `$OC_DRIVE_ROOT/OCRecipes/worktrees`), `OC_SKIP_NPM_CI=1` (tests only), `CLAUDE_CODE_SESSION_ID` (when set, runs `scripts/declare-worktree.sh <path>`).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(__dirname, "..", "oc-worktree.sh");

// Inherited git env overrides `git -C` inside the script under test — strip it
// (docs/solutions/logic-errors/inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md).
const GIT_ENV_UNSET = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_COMMON_DIR: undefined,
} as const;

let base: string;
let repo: string;
let wtDir: string;

const git = (args: string[], cwd = repo) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV_UNSET },
  });

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV_UNSET,
      // Never register a contract in the real session's registry.
      CLAUDE_CODE_SESSION_ID: undefined,
      OC_SKIP_NPM_CI: "1",
      // "/" is a mount point on macOS and Linux CI alike → predicate true.
      OC_DRIVE_ROOT: "/",
      OC_WORKTREES_DIR: wtDir,
      ...env,
    },
  });
}

beforeEach(() => {
  // realpathSync: macOS tmpdir() is a symlink to /private/var/...; git reports physical paths.
  base = realpathSync(mkdtempSync(join(tmpdir(), "oc-wt-")));
  repo = join(base, "repo");
  wtDir = join(base, "worktrees");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  writeFileSync(join(repo, "a.txt"), "a");
  git(["add", "a.txt"]);
  git(["commit", "-qm", "init"]);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("oc-worktree.sh", () => {
  it("exits 2 with usage when no branch is given", () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });

  it("refuses when the drive root is a plain directory, creating nothing", () => {
    const fake = join(base, "U34Bolt");
    mkdirSync(fake);
    const r = run(["feat-x", "main"], {
      OC_DRIVE_ROOT: fake,
      OC_WORKTREES_DIR: undefined,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not mounted/);
    expect(existsSync(join(fake, "OCRecipes"))).toBe(false);
  });

  it("refuses when the drive root does not exist", () => {
    const r = run(["feat-x", "main"], { OC_DRIVE_ROOT: join(base, "Nope") });
    expect(r.status).toBe(1);
    expect(existsSync(wtDir)).toBe(false);
  });

  it("creates a new branch from the base with no upstream", () => {
    const r = run(["feat-x", "main"]);
    expect(r.status).toBe(0);
    const dest = join(wtDir, "feat-x");
    expect(r.stdout.trim().split("\n").pop()).toBe(dest);
    expect(git(["rev-parse", "--abbrev-ref", "HEAD"], dest).trim()).toBe(
      "feat-x",
    );
    const up = spawnSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
      cwd: dest,
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
    expect(up.status).not.toBe(0);
  });

  it("checks out an existing local branch", () => {
    git(["branch", "existing"]);
    const r = run(["existing"]);
    expect(r.status).toBe(0);
    expect(
      git(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        join(wtDir, "existing"),
      ).trim(),
    ).toBe("existing");
  });

  it("tracks a remote-only branch instead of forking from the base", () => {
    const remote = join(base, "remote.git");
    execFileSync("git", ["init", "-q", "--bare", remote], {
      env: { ...process.env, ...GIT_ENV_UNSET },
    });
    git(["remote", "add", "origin", remote]);
    git(["checkout", "-qb", "feat/remote-only"]);
    writeFileSync(join(repo, "b.txt"), "b");
    git(["add", "b.txt"]);
    git(["commit", "-qm", "remote work"]);
    git(["push", "-q", "origin", "feat/remote-only"]);
    const tip = git(["rev-parse", "HEAD"]).trim();
    git(["checkout", "-q", "main"]);
    git(["branch", "-D", "feat/remote-only"]);
    git(["fetch", "-q", "origin"]);

    const r = run(["feat/remote-only"]);
    expect(r.status).toBe(0);
    const dest = join(wtDir, "feat-remote-only");
    expect(git(["rev-parse", "HEAD"], dest).trim()).toBe(tip);
    expect(git(["rev-parse", "--abbrev-ref", "@{u}"], dest).trim()).toBe(
      "origin/feat/remote-only",
    );
  });

  it("slugs slashes and spaces into a flat folder name", () => {
    const r = run(["feat/a b", "main"]);
    expect(r.status).toBe(0);
    expect(existsSync(join(wtDir, "feat-a-b"))).toBe(true);
  });

  it("refuses an existing destination without touching it", () => {
    mkdirSync(join(wtDir, "feat-x"), { recursive: true });
    writeFileSync(join(wtDir, "feat-x", "keep.txt"), "keep");
    const r = run(["feat-x", "main"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/already exists/);
    expect(existsSync(join(wtDir, "feat-x", "keep.txt"))).toBe(true);
  });

  it("outside a Claude session, skips the contract and still succeeds", () => {
    const r = run(["feat-y", "main"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/no worktree contract declared/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/oc-worktree.test.ts`
Expected: FAIL — every case exits 127 (`oc-worktree.sh: No such file or directory`).

- [ ] **Step 3: Write the implementation**

```bash
#!/usr/bin/env bash
# scripts/oc-worktree.sh — create an ad-hoc OCRecipes worktree on the U34Bolt drive.
#
# usage: oc-worktree.sh <branch> [<base>]   (base defaults to origin/main)
#   - existing local branch  → checked out as-is
#   - branch only on origin  → checked out tracking origin/<branch>
#   - otherwise              → new branch from <base>, no upstream
# Refuses (exit 1) unless the drive root is itself a mount point — a plain
# directory there is a phantom on the internal disk. /todo worktrees are NOT made
# here: they stay under <main>/.claude/worktrees (the isolation guards key on it).
# Spec: docs/superpowers/specs/2026-10-14-external-drive-design.md §4.
# Tests: scripts/__tests__/oc-worktree.test.ts
set -euo pipefail

usage() {
  echo "usage: oc-worktree.sh <branch> [<base>]" >&2
  exit 2
}

DRIVE="${OC_DRIVE_ROOT:-/Volumes/U34Bolt}"
WT_ROOT="${OC_WORKTREES_DIR:-$DRIVE/OCRecipes/worktrees}"
BRANCH="${1:-}"
BASE="${2:-origin/main}"
[ -n "$BRANCH" ] || usage

mount_point_of() { df -P "$1" 2>/dev/null | awk 'NR==2{print $6}'; }
if [ "$(mount_point_of "$DRIVE")" != "$DRIVE" ]; then
  echo "oc-worktree: $DRIVE is not mounted — refusing (it would write to the internal disk)" >&2
  exit 1
fi

SLUG=$(printf '%s' "$BRANCH" | tr '/' '-' | tr -c 'A-Za-z0-9._-' '-')
DEST="$WT_ROOT/$SLUG"
if [ -e "$DEST" ]; then
  echo "oc-worktree: $DEST already exists — refusing" >&2
  exit 1
fi

COMMON=$(git rev-parse --path-format=absolute --git-common-dir)
MAIN="${COMMON%/.git}"

mkdir -p "$WT_ROOT"
if git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git -C "$MAIN" worktree add "$DEST" "$BRANCH"
elif git -C "$MAIN" show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git -C "$MAIN" worktree add --track -b "$BRANCH" "$DEST" "origin/$BRANCH"
else
  git -C "$MAIN" worktree add --no-track -b "$BRANCH" "$DEST" "$BASE"
fi

# Ad-hoc worktrees get their own node_modules (~1 GB on the drive) — worktree-deps.sh
# deliberately symlinks only harness-managed worktrees.
if [ "${OC_SKIP_NPM_CI:-0}" != "1" ]; then
  (cd "$DEST" && npm ci)
fi

if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
  bash "$MAIN/scripts/declare-worktree.sh" "$DEST"
else
  echo "oc-worktree: not in a Claude session — no worktree contract declared"
fi

echo "$DEST"
```

Then: `chmod 755 scripts/oc-worktree.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/oc-worktree.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/oc-worktree.sh scripts/__tests__/oc-worktree.test.ts
git commit -F <msg-file>   # "feat(scripts): oc-worktree — ad-hoc worktrees on the external drive"
```

---

### Task 3: Reformat the drive and lay it out

**Files:** none in the repo. Creates `/Volumes/U34Bolt/README.md`.

- [ ] **Step 1: Re-check nothing unique is on the drive**

```bash
for w in /Volumes/U34Bolt/OCRecipes-cng2 /Volumes/U34Bolt/OCRecipes-e2epw; do
  echo "$w: $(git -C "$w" status --short | wc -l) dirty, $(git -C "$w" log @{u}.. --oneline | wc -l) unpushed"
done
ls /Volumes/U34Bolt/ocrecipes-build/src/.git 2>&1   # expect "No such file" (git-less build copy)
ls /Volumes/U34Bolt/tmp
```

Expected: both `0 dirty, 0 unpushed`; no `.git` under `src`; `tmp` holds only build scratch. **If anything differs, stop and tell the owner.**

- [ ] **Step 2: Detach the drive's worktrees from git**

```bash
git worktree remove /Volumes/U34Bolt/OCRecipes-cng2
git worktree remove /Volumes/U34Bolt/OCRecipes-e2epw
git worktree list
```

Expected: neither path listed. (Branch `feat/expo-cng-untrack` stays on origin and locally.)

- [ ] **Step 3: Owner reformats**

Run `diskutil list external` and confirm with the owner which identifier is the **1.0 TB external, physical** disk (it was `disk4` on 2026-10-14 — re-check; identifiers change between boots). Hand the owner, to type themselves:

```
! diskutil eraseDisk APFS U34Bolt GPT disk<N>
! sudo mdutil -i off /Volumes/U34Bolt
```

- [ ] **Step 4: Verify the format**

```bash
diskutil info /Volumes/U34Bolt | grep -E 'File System Personality|Owners'
mdutil -s /Volumes/U34Bolt
df -P /Volumes/U34Bolt | awk 'NR==2{print $6}'
```

Expected: `APFS` (not `Case-sensitive APFS`); `Indexing disabled`; `/Volumes/U34Bolt`. If `Owners: Disabled`, hand the owner `! sudo diskutil enableOwnership /Volumes/U34Bolt`.

- [ ] **Step 5: Create the layout**

```bash
mkdir -p /Volumes/U34Bolt/OCRecipes/{worktrees,build/xcodebuildmcp,tmp} \
         /Volumes/U34Bolt/_shared/caches/{npm,cocoapods,DerivedData}
```

- [ ] **Step 6: Write `/Volumes/U34Bolt/README.md`**

```markdown
# U34Bolt — external dev drive

APFS, case-insensitive, Spotlight indexing off. Shared by every project on this laptop.

## Rules

- One folder per project at the top level. Laptop-wide material goes under `_shared/`. Nothing loose at the top.
- Never put a project's main checkout or its database here — the laptop must work with the drive unplugged.
- "Is the drive mounted" means: `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]`.
  Never test with `[ -d /Volumes/U34Bolt ]` — a tool that writes here while the drive is unplugged creates a
  phantom folder on the internal disk, and the real drive then mounts as `U34Bolt 1`.

## Layout

- `OCRecipes/worktrees/` — ad-hoc OCRecipes worktrees (`scripts/oc-worktree.sh`)
- `OCRecipes/build/xcodebuildmcp/` — XcodeBuildMCP build output (`.xcodebuildmcp/config.yaml` in the repo)
- `OCRecipes/tmp/` — `TMPDIR` for big native builds, set per command only
- `_shared/caches/npm/` — `npm_config_cache` (set in `~/.zshenv`, only when mounted)
- `_shared/caches/cocoapods/` — `CP_CACHE_DIR` (same block)
- `_shared/caches/DerivedData/` — Xcode's `IDECustomDerivedDataLocation` (laptop-wide `defaults` key)

## Unplugged

npm and CocoaPods fall back to their normal locations automatically. Xcode and XcodeBuildMCP do not: a build
with the drive unplugged recreates `/Volumes/U34Bolt/...` on the internal disk. New shells warn when that
phantom exists — move anything needed out of it and delete it before plugging the drive back in.
```

- [ ] **Step 7: Measure and note**

`df -h /System/Volumes/Data` (internal unchanged — this task only affects the drive). Ledger-note "U34Bolt is APFS case-insensitive, indexing off" with the Step 4 command.

---

### Task 4: Remove Docker Desktop and the Android emulator

**Files:** none.

- [ ] **Step 1: Baseline** — `df -h /System/Volumes/Data`

- [ ] **Step 2: Quit Docker and run its uninstaller**

```bash
osascript -e 'quit app "Docker"' 2>/dev/null; true
ls /Applications/Docker.app/Contents/MacOS/uninstall
/Applications/Docker.app/Contents/MacOS/uninstall
```

If the uninstaller asks for an admin password or prompts interactively, hand it to the owner as `! /Applications/Docker.app/Contents/MacOS/uninstall`. Then:

```bash
mv /Applications/Docker.app ~/.Trash/ 2>/dev/null; true
rm -r ~/.docker
ls ~/Library/Containers/com.docker.docker 2>&1   # expect "No such file"
ls -la /usr/local/bin/docker* 2>&1               # expect none, or dangling links to report to the owner
```

- [ ] **Step 3: Delete the Android emulator (SDK stays)**

```bash
ls ~/.android/avd
rm -r ~/.android/avd/Medium_Phone.avd ~/.android/avd/Medium_Phone_API_36.1.ini
ls ~/Library/Android/sdk/system-images/android-36.1/google_apis_playstore/arm64-v8a >/dev/null && echo "system image kept"
```

Expected: `system image kept`.

- [ ] **Step 4: Measure** — expect roughly +16 GB. Ledger-note it.

---

### Task 5: Move OCRecipes worktrees off the internal disk

**Files:** none (uses Task 2's script).

**Interfaces:** Consumes `bash scripts/oc-worktree.sh <branch>` from Task 2 (on this branch).

- [ ] **Step 1: Verdict per internal worktree**

```bash
for w in ~/projects/OCRecipes-cng ~/projects/OCRecipes-wt-inspired ~/projects/OCRecipes-wt-inspired2; do
  b=$(git -C "$w" rev-parse --abbrev-ref HEAD)
  echo "$w branch=$b dirty=$(git -C "$w" status --short | wc -l) unpushed=$(git -C "$w" log @{u}.. --oneline 2>/dev/null | wc -l)"
done
```

Then look up each branch's PR state with `mcp__github__search_pull_requests` (`repo:<owner>/OCRecipes head:<branch>`). Verdict: **merged or detached** → remove only; **open PR** → remove and recreate with `oc-worktree`. Expected on 2026-10-14: `wt-inspired` (#1444 merged) remove; `cng` (detached) remove; `wt-inspired2` — check. Any dirty or unpushed → stop and ask the owner.

- [ ] **Step 2: Remove**

```bash
git worktree remove ~/projects/OCRecipes-cng
git worktree remove ~/projects/OCRecipes-wt-inspired
git worktree remove ~/projects/OCRecipes-wt-inspired2
git worktree prune
git worktree list
```

- [ ] **Step 3: Recreate `cng2` (PR #1438, open) on the drive**

```bash
bash scripts/oc-worktree.sh feat/expo-cng-untrack
```

Expected: last line `/Volumes/U34Bolt/OCRecipes/worktrees/feat-expo-cng-untrack`; `git -C <that> log -1 --oneline` matches the PR head on GitHub. Recreate any other open-PR worktree from Step 1 the same way.

- [ ] **Step 4: Measure** — expect roughly +3.4 GB. Ledger-note.

---

### Task 6: Redirect the tools

**Files:**

- Modify: `.xcodebuildmcp/config.yaml`
- Machine: `~/.zshenv` (append only), Xcode `defaults`

- [ ] **Step 1: XcodeBuildMCP config (repo)** — append to `.xcodebuildmcp/config.yaml`:

```yaml
# Build output goes to the external drive (docs/superpowers/specs/2026-10-14-external-drive-design.md §4.2).
# An explicit derivedDataPath is used as-is, not scoped per project — keep it OCRecipes-only.
# With the drive unplugged, xcodebuild recreates this path on the internal disk; new shells warn about it.
sessionDefaults:
  derivedDataPath: /Volumes/U34Bolt/OCRecipes/build/xcodebuildmcp
```

Commit it: `chore(xcodebuildmcp): build output on the external drive`.

- [ ] **Step 2: `~/.zshenv` block (append; never read the file — it holds a PAT)**

```bash
grep -c '>>> U34Bolt' ~/.zshenv   # expect 0; if 1, stop — already applied
cat >> ~/.zshenv <<'EOF'

# >>> U34Bolt external drive (see /Volumes/U34Bolt/README.md) >>>
_u34_root=/Volumes/U34Bolt
if [ "$(df -P "$_u34_root" 2>/dev/null | awk 'NR==2{print $6}')" = "$_u34_root" ]; then
  export npm_config_cache="$_u34_root/_shared/caches/npm"
  export CP_CACHE_DIR="$_u34_root/_shared/caches/cocoapods"
elif [ -e "$_u34_root" ] && [[ -o interactive ]]; then
  print -u2 "⚠ $_u34_root is a folder on the INTERNAL disk (drive not mounted) — a build wrote a phantom copy. Move anything you need out of it, then delete it before plugging the drive in."
fi
unset _u34_root
# <<< U34Bolt <<<
EOF
grep -c '>>> U34Bolt' ~/.zshenv   # expect 1
```

- [ ] **Step 3: Probe Xcode's behaviour with a missing path, then set the real one**

```bash
defaults write com.apple.dt.Xcode IDECustomDerivedDataLocation /Volumes/Nope/dd
```

Run one `npx expo run:ios --device "iPhone 17 Pro"` from the main checkout, then `ls -d /Volumes/Nope 2>&1`. If the build output shows `CONFIGURATION_BUILD_DIR` still under `~/Library/Developer/Xcode/DerivedData`, `expo run:ios` is not honouring the key — stop and report it (Step 6's DerivedData check would fail the same way). Record the answer (created or not) in the ledger and in the README's "Unplugged" paragraph if it differs. Then:

```bash
rm -r /Volumes/Nope 2>/dev/null; true
defaults write com.apple.dt.Xcode IDECustomDerivedDataLocation /Volumes/U34Bolt/_shared/caches/DerivedData
defaults read com.apple.dt.Xcode IDECustomDerivedDataLocation
```

- [ ] **Step 4: Delete the old caches**

```bash
rm -r ~/.npm/_cacache ~/Library/Caches/CocoaPods
```

(`~/.npm` keeps `_logs`/`_npx` — `_npx` holds the running XcodeBuildMCP; do not delete it.)

- [ ] **Step 5: Verify in a fresh shell**

```bash
zsh -lc 'npm config get cache; echo "CP_CACHE_DIR=$CP_CACHE_DIR"'
```

Expected: `/Volumes/U34Bolt/_shared/caches/npm` and `CP_CACHE_DIR=/Volumes/U34Bolt/_shared/caches/cocoapods`.

- [ ] **Step 6: Verify the builds land on the drive**

- `cd /Volumes/U34Bolt/OCRecipes/worktrees/feat-expo-cng-untrack/ios && pod install` (generate `ios/` first with `npx expo prebuild -p ios` if CNG removed it) → `ls /Volumes/U34Bolt/_shared/caches/cocoapods` non-empty; `ls ~/Library/Caches/CocoaPods` → "No such file".
- Main checkout: `npx expo run:ios --device "iPhone 17 Pro"` installs and launches → `ls /Volumes/U34Bolt/_shared/caches/DerivedData` shows an `OCRecipes-*` entry; `ls ~/Library/Developer/Xcode/DerivedData` shows none.
- Restart Claude Code (XcodeBuildMCP reads config at boot), call `session_show_defaults` → `derivedDataPath` is the drive path; one `build_sim` → `ls /Volumes/U34Bolt/OCRecipes/build/xcodebuildmcp` non-empty; `ls ~/Library/Developer/XcodeBuildMCP/workspaces` gains no OCRecipes entry.

If any check fails, stop and report the exact output — do not work around it with a symlink.

- [ ] **Step 7: Unplugged check (owner ejects the drive)**

Ask the owner to eject U34Bolt, then: `zsh -lc 'npm config get cache'` → `~/.npm` path. Then `mkdir /Volumes/U34Bolt` and open a new interactive shell (`zsh -ic true`) → the ⚠ warning prints. `rmdir /Volumes/U34Bolt`, owner re-plugs, `df -P /Volumes/U34Bolt | awk 'NR==2{print $6}'` → `/Volumes/U34Bolt` (not `U34Bolt 1`).

- [ ] **Step 8: Measure** — expect roughly +2.3 GB. Ledger-note.

---

### Task 7: Erase the two idle iPhone simulators

**Files:** none.

- [ ] **Step 1: Confirm use** (basis from the spec may have changed)

```bash
xcrun simctl list devices -j | python3 -I -c 'import json,sys; d=json.load(sys.stdin)["devices"]; [print(v.get("lastBootedAt","never"), v["state"], v["name"], v["udid"]) for r in d.values() for v in r if v["name"] in ("iPhone 17","iPhone 17e","iPhone 17 Pro")]'
```

Expected: iPhone 17 Pro most recent; 17 and 17e `Shutdown`. If either target is `Booted`, `xcrun simctl shutdown <udid>` first.

- [ ] **Step 2: Erase**

```bash
xcrun simctl erase 0D2AD2A4-EC17-493A-AAA2-99854C7DEF04   # iPhone 17
xcrun simctl erase 052A592B-C7DD-400C-B6A8-9A2719B3E756   # iPhone 17e
du -sh ~/Library/Developer/CoreSimulator/Devices/0D2AD2A4-EC17-493A-AAA2-99854C7DEF04 ~/Library/Developer/CoreSimulator/Devices/052A592B-C7DD-400C-B6A8-9A2719B3E756
```

Expected: each well under 100 MB.

- [ ] **Step 3: Measure** — expect roughly +10 GB. Ledger-note the total since Task 1.

---

### Task 8: Documentation, memory, PR

**Files:**

- Modify: `docs/DEV_SETUP.md` (new section after `## Native Builds (iOS / Android)`, line ~269)
- Machine: `~/.claude/CLAUDE.md`, memory dir

- [ ] **Step 1: `docs/DEV_SETUP.md` section**

```markdown
## External Drive (U34Bolt)

The internal disk is small; build output, ad-hoc worktrees and package caches live on the U34Bolt
Thunderbolt SSD. Layout and rules: `/Volumes/U34Bolt/README.md`. Design:
`docs/superpowers/specs/2026-10-14-external-drive-design.md`.

- **Ad-hoc worktrees:** `bash scripts/oc-worktree.sh <branch>` creates one under
  `/Volumes/U34Bolt/OCRecipes/worktrees/`, runs `npm ci`, and declares the worktree contract when run inside
  Claude Code. It refuses when the drive is not mounted. `/todo` worktrees are unaffected — they stay under
  `.claude/worktrees/`.
- **Big native builds:** set `TMPDIR=/Volumes/U34Bolt/OCRecipes/tmp` on the command only; never export it.
- **XcodeBuildMCP** builds into `/Volumes/U34Bolt/OCRecipes/build/xcodebuildmcp` (`.xcodebuildmcp/config.yaml`).
- **Stays internal on purpose:** the main checkout (hooks and Claude memory are keyed to its path), Postgres
  (preflight refuses its stamp without it), and `~/.claude`.
- **Drive unplugged:** everything still works. Xcode and XcodeBuildMCP builds recreate `/Volumes/U34Bolt` on the
  internal disk; new shells warn — delete that folder before plugging the drive back in.
```

- [ ] **Step 2: Global `~/.claude/CLAUDE.md`** — append (if the Edit is gated, stage the full file at `~/.claude/backups/CLAUDE.md.staged` and hand the owner one `cp` command):

```markdown
## External drive (U34Bolt)

`/Volumes/U34Bolt` is a shared dev SSD — read `/Volumes/U34Bolt/README.md` before putting anything on it.
One folder per project; laptop-wide caches under `_shared/`; nothing loose at the top. Before writing to it,
check it is mounted with `[ "$(df -P /Volumes/U34Bolt 2>/dev/null | awk 'NR==2{print $6}')" = /Volumes/U34Bolt ]`
(never `[ -d … ]`). Never put a project's main checkout or database on it.
```

- [ ] **Step 3: Memory**

- New `project_external_drive_u34bolt.md` (type project): layout, redirects (npm/CP_CACHE_DIR in `~/.zshenv`, Xcode `defaults`, XcodeBuildMCP config), the df predicate, unplugged behaviour, what stays internal and why; measured free space before/after. Add one line to `MEMORY.md` under Dev Tooling.
- Update `project_cng_decision_deferred_2026_09_30.md`: worktree path → `/Volumes/U34Bolt/OCRecipes/worktrees/feat-expo-cng-untrack`; `TMPDIR=/Volumes/U34Bolt/tmp` → `/Volumes/U34Bolt/OCRecipes/tmp`.
- Update `reference_sim_overlay_toast_verification.md`: iPhone 17 and 17e erased 2026-10-14; iPhone 17 Pro is the working simulator.

- [ ] **Step 4: Commit, push, PR**

```bash
git add docs/DEV_SETUP.md
git commit -F <msg-file>   # "docs(dev-setup): external drive section"
git push -u origin docs/external-drive-spec
```

Open the PR with `mcp__github__create_pull_request` (`head: docs/external-drive-spec`, base `main`), body ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then one review pass per `docs/AI_WORKFLOW.md` → Review Policy.

- [ ] **Step 5: Final measurement**

`df -h /System/Volumes/Data` — report free space versus the Task 1 baseline (target ≈ 57 GB free).
