---
title: "A worktree created nested inside another worktree silently defeats guard-worktree-isolation.sh's path arithmetic"
track: bug
category: logic-errors
tags: [git, worktree, security, isolation-guard, nested-worktree, hooks]
module: agents
applies_to: [".claude/hooks/guard-worktree-isolation.sh"]
symptoms: [An agent-*-named worktree created for validation/testing purposes while the orchestrator's own session is already inside another worktree, guard-worktree-isolation.sh treats the outer worktree as "main" instead of the true main checkout]
created: 2026-07-15
severity: medium
---

# A worktree created nested inside another worktree silently defeats guard-worktree-isolation.sh's path arithmetic

## Problem

`.claude/hooks/guard-worktree-isolation.sh` blocks an `Edit`/`Write` whose absolute path escapes an `agent-*`-named worktree into "the main checkout." Its path arithmetic assumes exactly one level of nesting: `cwd` matches `*/.claude/worktrees/agent-*`, and everything before that segment is "the main checkout." If a NEW `agent-*` worktree is created with a relative path while the current session's own cwd is already inside a *different* worktree (not the true top-level main checkout) — e.g. an orchestrator building/validating a feature from inside its own build worktree, which then creates a second worktree for an end-to-end dry run — the new worktree ends up nested *inside* the first one on disk. The hook's `MAIN_ROOT` computation then resolves to the *outer worktree*, not the true main checkout, and an edit that escapes all the way out to the real main checkout is misclassified as "entirely outside the repo — allowed" instead of being denied.

This was caught and avoided during design/validation (worked around by always creating sibling worktrees with absolute paths), not exploited or shipped — no application code was affected. It is documented as a latent gap in an existing, previously-shipped safety hook, for future skill authors who create worktrees from inside another worktree.

## Root Cause

`guard-worktree-isolation.sh`'s truncation logic:

```bash
WT_ROOT=$(printf '%s' "$CWD" | sed -E 's#(.*/\.claude/worktrees/agent-[^/]+).*#\1#')
MAIN_ROOT="${WT_ROOT%/.claude/worktrees/agent-*}"
```

strips exactly one `.claude/worktrees/agent-<name>` path component and treats everything before it as "main." If `CWD` is `.../outer-worktree/.claude/worktrees/agent-inner-name` (a worktree nested inside another worktree — `outer-worktree` itself not matching the `agent-*` pattern), `MAIN_ROOT` resolves to `.../outer-worktree`, not the filesystem's true top-level main checkout. `FILE_PATH` classification then falls through: a path under the TRUE main checkout (two levels up from `agent-inner-name`) matches neither `"$WT_ROOT"/*` nor `"$MAIN_ROOT"/*`, so it hits the `*) exit 0` branch — "entirely outside the repo (e.g. `/tmp`) — allowed" — when it should have been denied as an isolation escape.

This only manifests when a worktree is created via a **relative path** while the session's cwd is already inside another (non-`agent-*`-matching) worktree — `git worktree add` resolves relative destination paths against the current working directory, and worktree registrations are otherwise agnostic to nesting (git itself handles it fine; only this hook's path-string arithmetic assumes single-level nesting).

## Solution

When an orchestrating session that is already inside one worktree needs to create ANOTHER worktree (e.g. for an isolated dry-run/validation of a feature being built), always use an **absolute path rooted at the true top-level main checkout's `.claude/worktrees/`** for the new worktree's destination — never a relative path evaluated from inside the first worktree:

```bash
# WRONG when already cd'd into another worktree — nests on disk, confuses the isolation guard:
git worktree add ".claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"

# RIGHT — sibling to every other worktree, regardless of the current session's own cwd:
git worktree add "/Users/.../OCRecipes/.claude/worktrees/agent-todo-fast-$SLUG" -b "todo/$SLUG" "$BASE_BRANCH"
```

Verify with `node -e "console.log(path.match(/\/\.claude\/worktrees\/agent-/))"` (or equivalent) that the new worktree's absolute path contains the `agent-*` segment exactly once, and confirm via `git worktree list` that it is a sibling of, not nested inside, any other active worktree.

## Prevention

Any skill or session that creates worktrees programmatically (not via a native tool like `EnterWorktree`, which the harness manages directly and doesn't have this gap) should use absolute, top-level-anchored destination paths unconditionally — never assume the invoking session's cwd is the true main checkout. This matters most for validation/testing flows, since those are exactly the situations where an orchestrator is likely to already be inside its own build worktree when it needs to spin up a second, isolated one.

## Related Files

- `.claude/hooks/guard-worktree-isolation.sh` — the `WT_ROOT`/`MAIN_ROOT` truncation logic (single-level-nesting assumption, unchanged by this finding — worked around at the call site instead)
- `.claude/skills/todo-fast/SKILL.md` — Phase 1's shared-worktree creation, unaffected in shipped form (it documents using an absolute path implicitly via `$WORKTREE`'s `cd ... && pwd` resolution, but a future author extending it from inside another worktree should re-read this finding first)

## See Also

- [Ad hoc git worktrees outside .claude/worktrees/ get no node_modules symlink](../conventions/adhoc-worktree-missing-node-modules-symlink-2026-07-06.md) — a sibling gotcha about manually-created worktrees losing a different kind of automatic provisioning
