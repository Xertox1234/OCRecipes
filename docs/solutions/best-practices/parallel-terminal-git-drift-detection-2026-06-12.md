---
title: 'Parallel-terminal git drift detection: Pre+Post hook pair keyed by session_id'
track: knowledge
category: best-practices
module: shared
tags: [tooling, hooks, git, workflow]
applies_to: [.claude/hooks/*.sh, .claude/settings.json]
created: '2026-06-12'
---

# Parallel-terminal git drift detection: Pre+Post hook pair keyed by session_id

## Rule

When a user works in a parallel terminal while Claude operates on the same git
checkout, HEAD can advance without Claude knowing. Use a **Pre+Post hook pair**
to detect this: record the baseline SHA after each Claude-initiated HEAD-moving
op (PostToolUse), and compare against current HEAD before the next commit or
push (PreToolUse). Warn — never block.

## When this applies

Any interactive session where the user may commit, rebase, or push from a
parallel terminal while Claude is also making commits in the same checkout.
This is most common in the main checkout (not worktree) during iterative
feature work.

## Why

- The drift failure has three concrete modes: a "vanished" edit (user rebased
  it in), a moving HEAD (Claude's `git diff` is stale), and near-duplicate
  commits (Claude re-derives what the user just committed).
- A hard signal (hook) beats a soft signal (memory/docs) — the hook fires at
  the right moment (before `git commit`/`git push`) without Claude having to
  remember to check.
- Worktree isolation eliminates the problem entirely, but is opt-in for
  interactive sessions where the user wants to see the same checkout.

## Examples

### The hook pair

**`drift-detect.sh` (PreToolUse, fires on `git commit`/`git push`):**

1. Parse `session_id` from the hook JSON input (`jq -r '.session_id // empty'`).
2. Read stored SHA from `/tmp/claude-drift-detect-{session_id}`.
3. If no baseline file exists (first op): write current HEAD, exit silently.
4. If stored SHA == current HEAD: no drift, exit silently.
5. If stored SHA != current HEAD: emit `additionalContext` warning with both
   SHAs and reconciliation instructions. Never emit `permissionDecision: deny`.

**`drift-detect-update.sh` (PostToolUse, fires on all HEAD-moving git verbs):**

After any Claude-initiated `git commit`, `git push`, `git rebase`, `git reset`,
`git pull`, `git merge`, or `git cherry-pick` — write current HEAD to the
baseline file. Read-only ops (`status`, `log`, `diff`) must NOT trigger the
update: if they did, a drift occurring between a `git log` and a subsequent
commit would be silently absorbed.

### Key implementation details

- **Key by `session_id`, not `$PPID`.** `$PPID` differs across hook processes
  in the same session; `session_id` is stable and available as a top-level
  field in the hook JSON (`jq -r '.session_id // empty'`). If absent, skip
  detection silently — fail open.
- **No-baseline → silent bootstrap.** Write the current HEAD and exit without
  warning so the first commit of every session does not false-fire.
- **Silent on no-drift path.** Emitting "no drift detected" output violates
  `feedback_no_per_turn_hook_output` and creates noise on every commit.
- **`additionalContext`, not `systemMessage`.** `additionalContext` appears
  inline at the point of the tool call; `systemMessage` injects into the system
  prompt and persists. Transient per-commit warnings belong in `additionalContext`.
- **Fail open.** All parse and git errors exit 0. A hook crash must never
  block a legitimate commit.
- **`reset` is matched but idempotent.** `git reset` without `--hard` does not
  move HEAD, so `drift-detect-update.sh` fires and writes the same SHA already
  stored — harmless. Distinguishing reset sub-forms in the regex is not worth
  the complexity.

### Registration in `settings.json`

```json
// PreToolUse — Bash matcher
{ "type": "command", "command": "bash .claude/hooks/drift-detect.sh", "timeout": 10 }

// PostToolUse — Bash matcher
{ "type": "command", "command": "bash .claude/hooks/drift-detect-update.sh", "timeout": 10 }
```

### Worktree isolation decision

**Opt-in, not default** for interactive sessions. The user typically wants
Claude to work in the same checkout they are looking at. Worktree isolation is
the stronger fix for planned long-running automated sessions (e.g., `/todo`
executors already run in isolated worktrees by design). Use
`superpowers:using-git-worktrees` to set one up when the session is long and
the user is not co-authoring in the same checkout.

## Exceptions

- **Worktree sessions** (`.claude/worktrees/agent-*`): the worktree's HEAD is
  independent of the main checkout, so parallel-terminal drift from the user's
  main checkout is impossible. The hook still fires but the `/tmp` baseline is
  scoped to the session, so it is safe.
- **Read-only sessions** where Claude never commits: the hook fires on commit/push
  only, so it is a no-op for pure research/analysis sessions.

## Related Files

- `.claude/hooks/drift-detect.sh`
- `.claude/hooks/drift-detect-update.sh`
- `.claude/hooks/test-drift-detect.sh`
- `.claude/settings.json`

## See Also

- [agent-worktree-isolation-2026-05-16.md](agent-worktree-isolation-2026-05-16.md)
