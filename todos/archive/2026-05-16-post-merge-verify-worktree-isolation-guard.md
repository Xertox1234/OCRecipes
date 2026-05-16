---
title: "Post-merge: verify the worktree isolation guardrail with a live agent run"
status: done
priority: high
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, infrastructure, tooling, agents, verification]
github_issue:
---

# Post-merge: verify the worktree isolation guardrail with a live agent run

## Summary

After the `fix/worktree-isolation-leak` branch merges to `origin/main`, dispatch a real `isolation: "worktree"` agent and confirm the `guard-worktree-isolation.sh` `PreToolUse` hook actually fires and blocks a main-checkout edit, leaving `git status` on `main` clean.

## Background

The worktree-isolation-leak investigation (`docs/research/2026-05-16-worktree-isolation-leak-rca.md`) shipped the M1 guardrail hook and M2 workspace assertion on the `fix/worktree-isolation-leak` branch. One acceptance criterion of `todos/2026-05-16-investigate-worktree-isolation-leak.md` — a live follow-up agent run confirming isolation holds — could not be completed on the branch.

Reason: agent worktrees are created from `origin/main`, not the orchestrator's local branch (confirmed during the investigation — every probe worktree's HEAD equaled `origin/main`). So a verification agent dispatched before merge gets a worktree _without_ the guardrail hook, and the test would falsely pass. The verification must run only after the hook is on `origin/main`.

## Acceptance Criteria

- [x] After the branch is merged to `origin/main`, dispatch an `isolation: "worktree"` agent and confirm via a `PreToolUse` status message / behavior that `guard-worktree-isolation.sh` runs for worktree-isolated agents
- [x] Confirm the hook denies an `Edit`/`Write`/`MultiEdit` whose absolute `file_path` targets the main checkout from inside the worktree
- [x] Confirm `git status` on the main checkout stays clean after the agent run (no leaked files)
- [x] Check off the final acceptance criterion in `todos/2026-05-16-investigate-worktree-isolation-leak.md` and archive that todo to `todos/archive/`

## Implementation Notes

- The guardrail hook: `.claude/hooks/guard-worktree-isolation.sh`, registered for `Edit`/`Write`/`MultiEdit` in `.claude/settings.json`.
- A verification agent can be told to attempt a `Write` to an absolute path under the main checkout; a well-behaved agent may decline outright (observed during the investigation). To exercise the hook itself, the agent must actually issue the call — frame the probe so the agent attempts it, or inspect the hook firing via its status message on a normal in-worktree edit.
- The hook fails open on parse failure and when `jq` is absent — confirm `jq` is on PATH in the agent environment.
- Cross-reference the RCA's Phase 2 probe methodology for a safe reproduction approach.

## Dependencies

- Blocked until `fix/worktree-isolation-leak` is merged to `origin/main`.

## Risks

- A well-behaved agent may refuse the absolute-path write (seen in two investigation probes), making the deny path hard to exercise directly — may need to verify hook invocation indirectly.

## Updates

### 2026-05-16

- Initial creation. Split out from `todos/2026-05-16-investigate-worktree-isolation-leak.md` because the live verification cannot run until the guardrail is on `origin/main`. Flagged by the final code review of the `fix/worktree-isolation-leak` branch.

### 2026-05-16 — Verified, PASS

- PR #191 merged to `origin/main` (squash `f009b230`); the guardrail is live.
- A verification agent dispatched with `isolation: "worktree"` confirmed all criteria:
  - Its worktree (created from `origin/main`) contained `guard-worktree-isolation.sh`, executable, with 3 registrations in `.claude/settings.json`.
  - A relative in-worktree `Write` succeeded (normal operation unaffected).
  - A `Write` to the absolute main-checkout path `/Users/williamtower/projects/OCRecipes/verify-leak-marker.txt` was **denied** by the `PreToolUse` guardrail, with the expected actionable message.
  - `git status` on the main checkout stayed clean — `verify-leak-marker.txt` was never created.
- Probe worktree removed. Done — archiving this todo and the parent investigate todo.
