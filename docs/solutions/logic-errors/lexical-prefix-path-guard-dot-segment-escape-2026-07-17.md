---
title: "A lexical prefix-match path guard is escapable via dot segments — reject /../ and /./ components outright before matching"
track: bug
category: logic-errors
tags: [bash, guard-script, path-traversal, prefix-match, fail-closed, worktree, hooks]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: [A path allow/deny guard that compares with a case "$p" in "$ROOT"/*) prefix pattern allows a path like $ROOT/../../../elsewhere that lexically starts with the allowed root but resolves outside it, An allowlist prefix like /tmp/* launders a forbidden target written as /tmp/../real/target, A guard's traversal hole is reachable accidentally (agents concatenate "$DIR/../file") not just adversarially]
created: 2026-07-17
severity: high
---

# A lexical prefix-match path guard is escapable via dot segments — reject `/../` and `/./` components outright before matching

## Problem

Both registry-mode PreToolUse guards (`guard-worktree-isolation.sh`,
`git-safety.sh`) decided allow/deny by lexically prefix-matching the resolved
target path against registered worktree roots and an allowlist:

```bash
case "$p" in "$WT"|"$WT"/*) return 0 ;; esac      # inside the worktree — allowed
case "$p" in /tmp/*|/var/folders/*) exit 0 ;; esac # allowlisted scratch
```

Neither normalized dot segments, so `"$WT/../../../server/app.ts"` matched
`"$WT"/*` (allowed) while the write landed in the main checkout — the exact
incident class the deny exists for — and `/tmp/../Users/.../main/file` laundered
a main-checkout path through the allowlist. Reachable accidentally, not just
adversarially: agents build paths by concatenation (`"$DIR/../file"`).

## Solution

While the guard is active, refuse any path containing a `.` or `..` component
BEFORE any prefix comparison — appending a trailing `/` makes one pattern catch
mid-path and path-final segments uniformly:

```bash
case "${RESOLVED}/" in
  */../*|*/./*) deny "path contains . or .. components — re-issue normalized" ;;
esac
```

In helper form (used by both membership checks so unmatched paths fall toward
the deny side): `has_dot_segments() { case "${1}/" in */../*|*/./*) return 0 ;; *) return 1 ;; esac; }`

Do NOT "fix" this with `realpath`/`readlink -f` in this repo: worktree
provisioning intentionally symlinks shared gitignored dirs INTO worktrees
(`node_modules`, `.env*`), and resolving symlinks would re-root legitimate
in-worktree writes outside the worktree and break them. Rejecting unnormalized
input is the correct strictness: the caller can always re-issue a clean path,
and `SKIP_WORKTREE_CONTRACT=1` remains the sanctioned escape.

Regression tests: `.claude/hooks/test-guard-worktree-isolation.sh` ("absolute
path with .. escaping a worktree", "allowlist prefix with .. traversal") and
`.claude/hooks/test-git-safety.sh` ("git -C with .. escaping the worktree").

## Why it recurs

Prefix matching *feels* like a containment check, and every happy-path test
passes — only a path that lexically starts inside but resolves outside exposes
the difference. Found by adversarial security review (PR #652), not by the
original TDD suite, whose cases were all normalized paths.
