---
title: "Investigate agent worktree isolation leaking edits into the main working tree"
status: done
priority: high
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, infrastructure, tooling, agents]
github_issue:
---

# Investigate agent worktree isolation leaking edits into the main working tree

## Summary

During a `/todo` run, executor agents dispatched with `isolation: worktree` had their file edits land in the **main** working directory (`/Users/williamtower/projects/OCRecipes`) instead of staying confined to their `.claude/worktrees/agent-*` worktrees. Investigate the root cause and fix it so agent runs no longer pollute `main`.

## Background

On 2026-05-15/16, a `/todo` orchestrator run executed Phase 2 (Steps 5–6) of the pattern-codification refactor by dispatching `general-purpose` executor agents with `isolation: "worktree"`. Each agent was expected to work in an isolated git worktree, commit to its own branch, and open a PR — leaving `main` untouched.

Instead, after the run, `git status` on the main checkout showed **53 uncommitted changes** that were the agents' Step 5–6 edits (the 16 `docs/patterns/` → `docs/legacy-patterns/` renames, ~17 `.claude/agents/*.md` files, skill files, `docs/PATTERNS.md`, `docs/LEARNINGS.md`, several source/test files). The agents' worktrees _also_ contained the committed copies — so the same work existed in two places.

The user flagged this as happening "all of a sudden" / "so much" — implying a recent regression rather than longstanding behavior. Worth checking whether it correlates with a Claude Code version, a settings change, or recent worktree-feature behavior.

Related symptom from the same run: two executor agents stalled by self-pacing (`ScheduleWakeup` + `Monitor`) around a slow `kimi-review` command, and could not be resumed (`SendMessage` unavailable in this environment). One stalled agent (pid 6303) held a locked worktree for 8+ hours. The stall and the leak may or may not share a cause.

## Acceptance Criteria

- [x] Root cause identified for why `isolation: worktree` agent edits reach the main working tree
- [x] Determined whether the cause is the Claude Code harness, a hook, a `.claude/settings.json` misconfiguration, or agent tool-use behavior (e.g. absolute paths under the main repo root)
- [x] Reproduced the leak, or conclusively ruled out each hypothesis
- [x] Root-cause fix applied — OR, if the cause is the Claude Code harness and not fixable in-repo, the workaround documented
- [x] In-repo guardrail added so a future `/todo` run cannot silently re-leak (guardrail hook and/or todo-executor instruction hardening)
- [x] Recurrence-prevention pattern codified in `docs/solutions/`
- [x] A follow-up agent run verified to keep all edits isolated to its worktree (`git status` on main stays clean)

## Implementation Notes

- The leak was observed across multiple executor agents in a single session — not a one-off.
- Claude Code version at the time: `2.1.136` (from the pid 6303 command line).
- Check `.claude/settings.json` and `.claude/settings.local.json` for anything affecting worktree creation, working directory, or hook behavior.
- The `Agent` tool's `isolation: "worktree"` is documented to create an isolated worktree; confirm the worktree is actually created _and used as the agent's CWD_. If the agent's `Edit`/`Write`/`Bash` calls operate on absolute paths under the main repo root (`/Users/williamtower/projects/OCRecipes/...`) rather than the worktree root, edits would land in `main`.
- Inspect whether the `inject-patterns.sh` PreToolUse hook (or any hook) resolves `PROJECT_ROOT` to the main repo and causes side effects there.
- Check whether agents that self-paced/stalled behaved differently from the clean-completing one — the stalled first executor (`agent-a22fa743…`) and the two successful ones (`agent-af6727…`, `agent-a7f9306…`) are all candidates.
- Files in scope: `.claude/settings.json`, `.claude/hooks/inject-patterns.sh`, `.claude/agents/todo-executor.md`, `.claude/skills/todo/SKILL.md`.

## Dependencies

- None.

## Risks

- Environment/harness-dependent — may be hard to reproduce deterministically.
- If it is a Claude Code harness bug, the fix may be a version pin or upstream report rather than an in-repo change.

## Updates

### 2026-05-16

- Initial creation. Filed after a `/todo` run on `2026-05-12-phase-2-pattern-decomposition.md` left 53 uncommitted Step 5–6 changes in the main working tree despite all executor agents being dispatched with `isolation: worktree`. The intended work shipped correctly as PRs #189 and #190 (both merged); this todo tracks only the isolation-leak defect.

### 2026-05-16 — Root cause (Phases 1–3)

- Full RCA: `docs/research/2026-05-16-worktree-isolation-leak-rca.md`.
- The leak does **not** reproduce on Claude Code `2.1.142`. Worktree isolation works for the normal flow: a worktree-isolated agent's cwd is its worktree and relative paths resolve there (Probe 1).
- Root cause of the residual risk: **the harness resolves absolute paths literally with no worktree sandbox** (Probe 4). Any `Edit`/`Write` carrying an absolute `file_path` under the main checkout writes into `main`, regardless of the agent's worktree. Today only agent caution prevents this — two probe agents correctly refused such writes.
- The hook hypothesis is ruled out: `inject-patterns.sh` resolves `PROJECT_ROOT` from `BASH_SOURCE` and never writes files.
- New finding: agent worktrees are created from `origin/main`, not the orchestrator's local HEAD — this affects how the guardrail must be verified (see RCA "Plan adjustments").
- Proceeding to the M1 guardrail hook + M2 workspace assertion.

### 2026-05-16 — Mitigation shipped (Tasks 4–6)

- **M1 guardrail hook:** `.claude/hooks/guard-worktree-isolation.sh`, a `PreToolUse` hook registered for `Edit`/`Write`/`MultiEdit` in `.claude/settings.json`. Denies an absolute-path edit targeting the main checkout when the session cwd is inside `.claude/worktrees/agent-*`.
- **M2 workspace assertion:** `.claude/agents/todo-executor.md` gained a `Step 0 — Workspace assertion` — the executor reports `blocked` if not running in a worktree and keeps edit paths inside its worktree.
- **Pattern codified:** `docs/solutions/best-practices/agent-worktree-isolation-2026-05-16.md`.
- **Remaining:** the live follow-up agent run that confirms `git status` on `main` stays clean is deferred until after this branch merges to `origin/main` — agent worktrees are created from `origin/main`, so the guardrail must be there before a freshly dispatched agent's worktree will contain it.

### 2026-05-16 — Verified (post-merge)

- PR #191 merged to `origin/main` (squash `f009b230`). A verification agent dispatched with `isolation: "worktree"` confirmed the guardrail end-to-end: its worktree (created from `origin/main`) contained the registered hook, a relative in-worktree write succeeded, and a `Write` to an absolute main-checkout path was **denied** by `guard-worktree-isolation.sh`. `git status` on `main` stayed clean — no leak. Final acceptance criterion met; see `todos/archive/2026-05-16-post-merge-verify-worktree-isolation-guard.md`.
