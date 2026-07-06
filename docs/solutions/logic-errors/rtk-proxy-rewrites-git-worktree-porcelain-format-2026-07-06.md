---
title: "rtk's git worktree list --porcelain output isn't real porcelain — breaks line-anchored parsing"
track: bug
category: logic-errors
tags: [git, worktree, rtk, bash, todo-skill]
module: shared
applies_to: [".claude/skills/**/*.md", ".claude/agents/**/*.md", "scripts/**/*.sh"]
symptoms: [A worktree-cleanup loop parsing `git worktree list --porcelain` silently processes zero worktrees even though several exist, A `while read` loop over the parsed output produces no output and no error — it just does nothing, `awk '/^worktree /'` matches nothing despite `git worktree list` (no flags) showing worktrees are present]
created: 2026-07-06
severity: medium
---

# rtk's git worktree list --porcelain output isn't real porcelain — breaks line-anchored parsing

## Problem

A `/todo` orchestrator run's Phase 0 and Phase 5 cleanup steps parse `git worktree list --porcelain` with `awk '/^worktree /'` to find and force-remove leftover executor worktrees (they are created locked, so a bare `git worktree prune` can't touch them). On this machine the loop silently removed nothing — not one worktree, no error — even though `git worktree list` (no flags) clearly showed several `.claude/worktrees/agent-*` directories present.

## Symptoms

- A worktree-cleanup `while read` loop over parsed `--porcelain` output produces zero `removed worktree: ...` lines, with no error surfaced anywhere.
- `git worktree list --porcelain | awk '/^worktree /'` returns nothing, but `git worktree list` (plain) clearly lists worktrees.
- A "fixed" version that switches to matching path/branch content instead of the `worktree ` prefix still fails with `fatal: '~/...' is not a working tree` if the matched path starts with `~`.

## Root Cause

This project's `rtk` CLI hook (see `CLAUDE.md` / `RTK.md`) transparently rewrites shell `git` invocations for token savings — `git status` → `rtk git status`, etc. Under this proxy, `git worktree list --porcelain` does not return git's real porcelain contract (`worktree <path>` / `HEAD <sha>` / `branch <ref>` on separate lines, blank-line-separated, absolute paths). Instead it returns a condensed, human-readable single-line-per-worktree format — path (with `~`-shorthand), abbreviated SHA, `[branch]`, optional `locked` flag — much closer to plain `git worktree list`'s output shape. Any parser written against the documented `--porcelain` contract (`awk '/^worktree /'`) silently matches zero lines under this rewrite, with no error, because the anchor line format never appears.

A second, independent bug compounds the first once you switch to parsing the condensed format: the displayed path uses `~` shorthand, and `read -r wt` assigns that literal string (including the `~`) to the shell variable. Bash tilde-expansion only applies to unquoted literal tokens written directly in a command line — it does **not** re-expand a variable's stored value when that variable is later substituted (`"$wt"`), so `git worktree remove --force "$wt"` fails with `fatal: '~/...' is not a working tree` even though the same path typed directly at a prompt would work.

## Solution

Two changes, both needed:

1. **Parse the actual output your environment returns, not the documented contract.** Match on content (the worktree path pattern) rather than the porcelain line prefix, and read plain `git worktree list` instead of `--porcelain`. Extract the path by **stripping the known trailing `<sha> [<branch>]` suffix**, not by splitting on whitespace (`{print $1}`) — the plain format is `<path> <sha> [<branch>]`, and a path containing a space (a plausible `$HOME`, e.g. `/Users/Jane Doe/...`) would otherwise be silently truncated to its first word, mis-targeting `git worktree remove`:
   ```bash
   git worktree list | awk '/\.claude\/worktrees\/agent-/ {sub(/ +[0-9a-f]{4,40} +\[[^]]*\].*$/, ""); print}' | while read -r wt; do
     wt="${wt/#\~/$HOME}"
     git worktree unlock "$wt" 2>/dev/null
     git worktree remove --force "$wt" 2>/dev/null && echo "removed worktree: $wt"
   done
   git worktree prune
   ```
2. **Manually expand a leading `~`** on any path pulled out of `read` before passing it to a command that needs a real filesystem path — `wt="${wt/#\~/$HOME}"` (bash parameter expansion, prefix-anchored) is sufficient and harmless in a non-proxied environment where paths are already absolute (the pattern simply never matches).

## Prevention

Before trusting a documented CLI output contract (a porcelain format, `--json`, etc.) inside a script meant to run unattended across environments, do a live probe of the actual first few lines rather than assuming a proxy-free environment. Any script that shells out to `git` in this repo should assume `rtk`'s rewrite may be active and verify against real output, not just the documented flag semantics.

## Related Files

- `.claude/skills/todo/SKILL.md` — Phase 0 step 1 and Phase 5 step 6, both fixed alongside this solution (2026-07-06)
- `RTK.md`, `CLAUDE.md` — document the `rtk` hook's transparent command rewriting

## See Also

- [adhoc-worktree-missing-node-modules-symlink](../conventions/adhoc-worktree-missing-node-modules-symlink-2026-07-06.md) — another worktree-environment gotcha specific to this project's tooling
