---
title: 'Claude Code worktree isolation refuses any $ value in a command that names git, and every rtk-rewritten git verb — run git plainly, put logic in a script file'
track: knowledge
category: best-practices
module: agents
tags: [agents, tooling, harness]
applies_to: [.claude/agents/*.md, .claude/skills/*/SKILL.md, docs/AI_WORKFLOW.md]
created: '2026-10-31'
---

# Claude Code worktree isolation refuses any $ value in a command that names git

An agent dispatched with `isolation: "worktree"`, or a session after `EnterWorktree`, runs in
`<repo>/.claude/worktrees/agent-*`. Claude Code then refuses any Bash command it cannot prove,
from the text alone, stays inside that worktree. The message starts "This agent is isolated in
the worktree …". It comes from Claude Code itself, not from a project hook, so
`SKIP_WORKTREE_CONTRACT=1` does not lift it.

Over 20 days (10-10 → 10-30) this refused 452 commands, 418 of them in subagents. It was the
largest single source of errored tool calls (harness diagnosis item 2).

## What runs and what is refused (measured 2026-10-31, two isolated probe agents, 27 forms)

| Form | Verdict |
| --- | --- |
| `git rev-parse HEAD`, `git ls-remote --heads origin main` | runs |
| plain git joined with `;`, `&&`, `\|` (`git rev-parse HEAD && git rev-parse --abbrev-ref HEAD`) | runs |
| `cd <literal path> && git …`, `git -C <literal path> …`, `/usr/bin/git …` | runs |
| `bash <script file>` — even when the script runs git; its contents are not read | runs |
| `git commit -m "$(cat <<'EOF' … EOF )"` (quoted heredoc value) | runs |
| `$` values in a command that does not name git (`SENS=$(grep …); echo "$SENS"`) | runs |
| `git ls-remote …; echo ls=$?` | refused |
| `X=$(git rev-parse HEAD); echo $X`, `echo "$(git rev-parse --show-toplevel)"` | refused |
| `/usr/bin/git rev-parse HEAD; X=1; echo $X` — a `$` unrelated to git still counts | refused |
| `bash -c 'git rev-parse HEAD'` | refused |
| `. lib.sh && fn` — even with no git in the text | refused |
| `sed` with a `$` in its program | refused |
| `git status` (bare) — rtk's hook rewrites it to `rtk git status` | refused |

rtk rewrites 13 git verbs: status, add, commit, diff, log, show, branch, checkout, fetch, push,
pull, stash and worktree (`rtk hook check 'git <verb> x'`). Every one of those is refused in an
isolated worktree unless the rewrite is skipped there. The user-level wrapper
`~/.claude/hooks/rtk-hook-outside-isolated-worktrees.sh` does that when the hook input's `cwd` is
under `*/.claude/worktrees/*`. Without it, use `/usr/bin/git`.

## How to write agent and skill instructions

- **One git command per call, values typed back literally.** Don't capture with
  `X=$(git …)`. Run the command, read its output, and write the value into the next command.
- **Never append `echo $?`.** The Bash tool already reports the exit code.
- **Logic with variables or loops goes in a committed script, run with `bash <file>`.** Example:
  `scripts/review-record-status.sh <pr>` replaced the todo-executor's inline
  `. review-stamp-path.sh && …` record checks.
- **Pass paths as literals**, e.g. `bash scripts/declare-worktree.sh /abs/worktree/path`, not
  `"$(git rev-parse --show-toplevel)"`.
- **A reviewer dispatched from an isolated executor inherits the isolation.** Tell it to type
  the worktree path literally in every command, never `W=…; git -C $W`.

`.claude/hooks/test-executor-isolation-forms.sh` fails CI when a fenced shell snippet in
`.claude/agents/todo-executor.md` uses a refused form. It checks one line at a time, so a
command split over lines, with git on one line and `$` on another, is missed.

## Related Files

- `.claude/agents/todo-executor.md`: Step 0, "Command forms that worktree isolation accepts"
- `scripts/review-record-status.sh`
- `.claude/hooks/test-executor-isolation-forms.sh`
- `.claude/hooks/test-review-record-status.sh`
- `docs/AI_WORKFLOW.md`: Working-tree safety and the reviewer dispatch prompt
