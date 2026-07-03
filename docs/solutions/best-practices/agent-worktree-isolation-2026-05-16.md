---
title: 'Agent worktree isolation: absolute paths can leak edits into the main checkout'
track: knowledge
category: best-practices
module: agents
tags: [agents, tooling]
applies_to: [.claude/agents/*.md, .claude/hooks/*.sh, .claude/settings.json]
created: '2026-05-16'
---

# Agent worktree isolation: absolute paths can leak edits into the main checkout

Agents dispatched with `isolation: "worktree"` run with their cwd set to their
`.claude/worktrees/agent-*` worktree; relative paths and worktree-rooted absolute
paths stay isolated. But the Claude Code harness resolves absolute paths
**literally, with no worktree sandbox** — an `Edit`/`Write`/`MultiEdit` carrying
an absolute `file_path` under the main checkout writes into `main` regardless of
the agent's worktree. (Confirmed on CC 2.1.142; the leak does not occur through
normal relative-path operation.)

**Guardrail (M1):** `.claude/hooks/guard-worktree-isolation.sh` is a `PreToolUse`
hook that denies an `Edit`/`Write`/`MultiEdit` whose absolute `file_path` is
under the main checkout but outside the worktree, when the session cwd is inside
`.claude/worktrees/agent-*`. It fails open on parse failure.

**Prevention (M2):** the `todo-executor` agent asserts its workspace in `Step 0`
(reports `blocked` if not running in a worktree) and is instructed to keep every
edit path inside its worktree.

See the full root-cause analysis: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`.
