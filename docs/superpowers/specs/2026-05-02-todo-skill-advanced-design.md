# Advanced /todo Skill Design

## Overview

Three enhancements to the existing `/todo` skill (`SKILL.md` + `todo-executor.md`) that make it end-to-end autonomous: live library research before each implementation, per-todo GitHub PRs as the integration point, and uniform worktree isolation for all todos.

---

## Enhancement 1 — Research Subagent

### Problem

The executor's Step 3 was static: it read local `docs/patterns/*.md` files based on the todo's labels. This meant the executor had no awareness of current library API changes, project-specific GitHub issues, or how similar problems had been solved publicly.

### Design

A new `todo-researcher` subagent (`.claude/agents/todo-researcher.md`) is spawned by the executor at the start of Step 3. It:

1. Reads the todo file to extract title, labels, Implementation Notes, and Acceptance Criteria
2. Detects library families from the affected file paths using a path→library table
3. Fires three tracks in parallel using a two-turn strategy:
   - **2a (Context7 MCP)**: `resolve-library-id` → `query-docs` per detected library (Turn 1: all resolve calls; Turn 2: query-docs as each ID arrives)
   - **2b (GitHub MCP, repo)**: search OCRecipes issues/PRs for related prior work
   - **2c (GitHub MCP, global)**: search public repos for similar patterns
4. Returns a ≤300-word brief with three required sections: `## Library Notes`, `## Project Context`, `## Global Patterns`

### Fallback

If the researcher subagent is unavailable or returns text missing all three section headers, the executor falls back to the existing static label→doc mapping. The executor always also greps `docs/LEARNINGS.md` and `todos/archive/` and reads source files directly, regardless of whether the researcher succeeded.

### Key decision: section-header detection

The executor detects a valid brief by checking for the presence of the three section headers — not by checking for a non-empty response. This correctly distinguishes "no results found" (valid brief) from "subagent failed" (missing headers).

---

## Enhancement 2 — Per-Todo GitHub PRs

### Problem

The old executor merged worktree branches back into the base branch locally after each batch. This required the orchestrator to handle merge conflicts between parallel todos and meant there was no code review gate between implementation and integration.

### Design

Each executor (Step 10) opens a GitHub PR from its worktree branch instead of merging locally:

1. Determine slug from todo filename: `scan-confirm-null-calories-guard.md` → `scan-confirm-null-calories-guard`
2. Rename worktree branch: `git branch -m todo/<slug>`
   - If local `todo/<slug>` already exists (prior failed run): `git branch -D todo/<slug>` then retry
3. Push: `git push -u origin todo/<slug>`
   - If rejected (remote branch already exists): `git push --force-with-lease` — safe because the branch name is deterministic and the remote branch always belongs to this same todo
4. Create PR via `mcp__github__create_pull_request`
   - If PR already exists: look up URL via `mcp__github__list_pull_requests` before falling back to `PR_URL: null`

The orchestrator collects `PR_URL` from each executor's Step 11 report and displays it in the Phase 5 summary table. If PR creation fails, the code is still committed and pushed — `PR_URL: null` signals the PR needs to be opened manually.

### Key decision: GitHub as integration point

No local merge-back means no merge conflicts between parallel todos. GitHub becomes the integration point, which also opens the door to GitHub Actions automation (CI, Copilot code review, etc.) on each todo branch.

---

## Enhancement 3 — Uniform Worktree Isolation

### Problem

Sequential todos in the old orchestrator ran directly on the base branch (no `isolation: "worktree"`). This was inconsistent with parallel todos (which always used worktrees) and meant sequential todos could leave uncommitted changes in the working tree if they failed mid-execution.

### Design

All executor dispatches — both parallel and sequential — use `isolation: "worktree"`. The orchestrator:

1. Captures `BASE_BRANCH` in Phase 1 using `git branch --show-current` (with `git rev-parse --abbrev-ref HEAD` fallback and a hard stop if HEAD is detached)
2. Threads `BASE_BRANCH` into every executor spawn via a `Base branch: <BASE_BRANCH>` line in the prompt
3. After each batch, runs `npm run check:types` on the base branch only — never `npm run test:run` between batches (accepted tradeoff: faster batches, test regressions surface at Phase 5)

The executor's Failure Path note was updated to reflect worktree isolation: reverts only affect the worktree, not the base branch.

---

## Files

| File                                | Action | Change                                                                                                     |
| ----------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `.claude/agents/todo-researcher.md` | Create | New research subagent                                                                                      |
| `.claude/agents/todo-executor.md`   | Modify | Step 3 spawns researcher; Step 6 adds Agent() template; Step 10 (new) PR creation; Step 11 (was 10) Report |
| `.claude/skills/todo/SKILL.md`      | Modify | BASE_BRANCH capture; sequential worktrees; no merge-back; PR column in summary                             |
| `docs/patterns/agents.md`           | Create | Two-turn parallel MCP strategy; section-header agent protocol                                              |

---

## Error Handling

| Failure                                     | Behavior                                                               |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Researcher subagent unavailable             | Fall back to label→doc mapping; log "researcher unavailable"           |
| Researcher returns no section headers       | Same fallback as unavailable                                           |
| `git branch -m` fails (local branch exists) | `git branch -D todo/<slug>` + retry                                    |
| `git push` rejected (remote exists)         | `--force-with-lease`                                                   |
| PR already exists                           | Look up URL via `list_pull_requests` before falling back to null       |
| PR creation fails for any other reason      | `PR_URL: null`; code is committed; manual PR creation                  |
| BASE_BRANCH is empty (detached HEAD)        | Fallback to `git rev-parse --abbrev-ref HEAD`; hard stop if still HEAD |
| Post-batch type check fails                 | Halt session; report to user; do not start next batch                  |
