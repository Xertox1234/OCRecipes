---
title: "A shell variable captured in one Phase's Bash call is gone by the next Phase's separate Bash call"
track: knowledge
category: conventions
tags: [bash, orchestrator, skill-authoring, cwd, shell-state, multi-phase]
module: agents
applies_to: [".claude/skills/**/*.md", ".claude/agents/**/*.md"]
symptoms: [A skill's later Phase references a variable ($WORKTREE, $BASE_BRANCH, $MAIN_CHECKOUT) captured in an earlier Phase's bash block with no instruction to re-derive or literally substitute it, An agent's own bash cwd unexpectedly reverts to its session's ambient default between two separate Bash tool calls despite an earlier `cd`]
created: 2026-07-15
---

# A shell variable captured in one Phase's Bash call is gone by the next Phase's separate Bash call

## When this applies

Any multi-phase orchestrator skill (`.claude/skills/*/SKILL.md`) or multi-step agent (`.claude/agents/*.md`) whose prose describes capturing a value in one Phase/Step's bash snippet (`WORKTREE=$(...)`, `BASE_BRANCH=$(git branch --show-current)`, `MAIN_CHECKOUT=$(...)`) and using that variable name in a LATER Phase/Step's bash snippet. This is the general form of the rule [resolve-diff-range-once-for-branch-diff-skills](resolve-diff-range-once-for-branch-diff-skills-2026-06-20.md) already documents for `/codify`'s specific diff-range case.

## Rule

Shell state — both the working directory (`cd`) and variables (`VAR=value`) — does **not** persist between separate Bash tool calls, whether within the controlling session or inside a dispatched subagent's own turn. Each Bash invocation starts fresh from whatever cwd the harness assigns by default; an earlier call's `cd` or variable assignment has no effect on a later, separate call. This holds even when a skill's prose visually presents the two calls as sequential "Phase 1... Phase 2..." steps — the model must either (a) re-derive the value inline in every bash block that needs it, or (b) explicitly carry the *literal resolved value* in its own working context and substitute it into every later dispatch prompt/bash block, never referencing the shell variable name as if it were still live.

## Why

`/todo-fast`'s Phase 1 captures `$WORKTREE` in one bash block (`git worktree add ...; WORKTREE=$(cd ... && pwd)`) and a later fix added `$MAIN_CHECKOUT` to the same block — but the skill's Phase 0 *also* captures `MAIN_CHECKOUT` earlier, in a genuinely separate bash call, with no explicit note telling the orchestrator to substitute the recorded literal rather than reference the bare variable name across the phase boundary. A whole-branch code review caught this: the dominant failure mode is loud (an empty substitution makes `git worktree add` fail visibly, before the symlink line is even reached), but a narrower failure — substituting `$BASE_BRANCH` correctly while leaving `$MAIN_CHECKOUT` as a dangling literal — would silently symlink garbage. The fix was to re-derive `MAIN_CHECKOUT` inline in the same block that consumes it, removing the cross-call dependency entirely, rather than relying on correct substitution discipline.

A separate but related instance: a subagent executing a multi-phase validation run issued one Bash call with an explicit `cd "$WORKTREE" && ...` prefix, then a LATER, separate Bash call without the prefix — that later call silently executed against the agent's own session-default cwd (its parent/home worktree), not the worktree the prefix had established a moment before. The agent only noticed because the output looked wrong (an unexpected file present). The general lesson generalizes beyond diff-ranges and beyond cwd: **treat every value that matters as needing to survive the tool-call boundary explicitly**, whether that means re-deriving it, or carrying it in context and substituting the literal.

## Examples

Prefer re-deriving over cross-call variable references when the derivation is cheap:

```bash
# Self-contained — works regardless of what ran in a prior, separate Bash call:
WORKTREE="$(cd ".claude/worktrees/agent-todo-fast-$SLUG" && pwd)"
MAIN_CHECKOUT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
ln -sf "$MAIN_CHECKOUT/node_modules" "$WORKTREE/node_modules"
```

When re-derivation isn't cheap or possible (e.g. a value computed via an expensive external call, or one that must exactly match an earlier decision), carry the **literal resolved value** in the model's own working context — the same discipline `resolve-diff-range-once-for-branch-diff-skills` already prescribes for diff ranges — and substitute it explicitly into every later bash block or dispatch prompt, never as a bare `$VAR` reference assumed to still be live.

When issuing multiple sequential Bash commands that must share a working directory, prefix EVERY command that matters with the same explicit `cd "$TARGET" && ...` — never rely on an earlier call's `cd` (or a subagent's own prior `cd`) still being in effect.

## Exceptions

Commands **within the same single Bash tool call** (joined by `&&`, `;`, or a heredoc) share shell state normally — this rule is specifically about separate, sequential tool-call invocations, not compound commands inside one call.

## Related Files

- `.claude/skills/todo-fast/SKILL.md` — Phase 1, `MAIN_CHECKOUT` re-derived inline rather than referenced from Phase 0's separate capture

## See Also

- [Resolve the diff range once for branch-diff skills; never scatter literal main...HEAD](resolve-diff-range-once-for-branch-diff-skills-2026-06-20.md) — the diff-range-specific instance of this same underlying rule
