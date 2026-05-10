# Design: Audit Skill Improvements — Worktrees, kimi-review, Phase Cleanup

> **Date:** 2026-05-10
> **Trigger:** Audit skill has drifted from current project conventions: kimi-review is now the standard review tool (not the code-reviewer subagent); git worktrees are standard for isolating work; Phase 6 (code-reviewer subagent) duplicates per-fix verification and is the wrong mechanism. Minor instruction ambiguities have also accumulated.

## Problem

Four gaps identified in the current 8-phase audit skill:

1. **No workspace isolation** — Audit fixes run directly in the main workspace, blocking other development work during long audits.
2. **Wrong review mechanism in Phase 6** — The skill dispatches `.claude/agents/code-reviewer.md` as a subagent over a list of changed files and text descriptions. The project standard is `kimi-review` (with OCRecipes profile auto-detection and `--patterns` domain context), not a Claude subagent.
3. **Agent batching ambiguity in Phase 2** — "four batches: 4, 4, 4, 3" implies 15 agent invocations but audits run 7 (one per domain). The table's "Primary Agent(s)" column lists which agent types to use, not separate invocations.
4. **Copilot delegate in Phase 4** — References `npm run copilot:delegate`, which is no longer the project's delegation model. kimi-write is now the cheap-worker for boilerplate/straightforward deferred work.

## Design

### Section 1: Worktree Isolation (Phase 1 addition)

Phase 1 gains two steps at the end, after the baseline is recorded:

1. Capture the current branch: `git branch --show-current`
2. Create and enter an audit worktree — all Phases 2–7 run from it

Use the `using-git-worktrees` pattern (EnterWorktree or `git worktree add`) to create the worktree. The worktree is cleaned up after the Phase 6 commit.

**Why:** Long full audits (40+ findings) can take hours. Without isolation, urgent fixes in the main workspace conflict with in-progress audit edits.

### Section 2: Per-Fix kimi-review in Phase 3 (replaces Phase 6)

After each fix passes its tests, run kimi-review with domain-matched patterns:

```bash
kimi-review --scope "[one-line fix description]" --patterns [domain]
```

Domain → patterns mapping:

| Finding Domain | --patterns value                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| security       | `security`                                                                                                |
| performance    | `performance`                                                                                             |
| data-integrity | `database`                                                                                                |
| architecture   | `architecture`                                                                                            |
| code-quality   | `typescript,api`                                                                                          |
| camera / RN-UX | `react-native`                                                                                            |
| accessibility  | `react-native` (no `docs/patterns/accessibility.md` exists yet; add it to `--patterns` if one is created) |

Response handling:

- **CRITICAL**: Stop. Surface to user. Do not mark `verified` until resolved — fix it, re-run tests + kimi-review.
- **WARNING**: Fix inline as part of the same finding. Re-run tests + kimi-review.
- **SUGGESTION**: Proceed — mark `verified`. Note the suggestion in the manifest Verification column if it's worth tracking for codification.

This replaces the current Phase 6 (Code Review subagent) entirely. By the time the Commit phase runs, every fix has already been kimi-reviewed.

**Why `--patterns [domain]`:** kimi-review's `--patterns` flag loads the matching `docs/patterns/*.md` file as review context, giving Kimi the project's domain-specific rules (e.g., IDOR checks from `security.md`, FlatList defaults from `performance.md`) in addition to the auto-detected OCRecipes profile.

### Section 3: Phase Renumbering and Rationale Update

Phase 6 (Code Review) is removed. Remaining phases shift:

| Old     | New     | Name                   |
| ------- | ------- | ---------------------- |
| Phase 6 | removed | Code Review (subagent) |
| Phase 7 | Phase 6 | Commit Fixes           |
| Phase 8 | Phase 7 | Codify                 |

The "why the order" note at the bottom of the skill is updated: kimi-review is now per-fix (inside Phase 3), so by the time Phase 6 (Commit) runs all fixes are already reviewed and verified. Codification stays last so the codifier sees the complete picture — audit fixes and any kimi-review-triggered corrections together.

### Section 4: Minor Instruction Cleanups

**Agent batching in Phase 2:** Replace the "four batches: 4, 4, 4, 3" instruction with:

> For a full audit, launch **one agent invocation per domain row** (7 total). Batch in two groups — first 4 domains, then 3 — to avoid overwhelming context. The "Primary Agent(s)" column shows which agent type to use for each invocation; list both agents in the prompt when two are shown.

**Phase 4 Copilot delegate:** Remove `npm run copilot:delegate` references. Replace with: for low/deferred items that are straightforward boilerplate or test-only work, use `kimi-write` to generate a first pass — review before committing. For items that need human judgment, leave the todo local and note the rationale.

## Files Changed

| File                            | Change                  |
| ------------------------------- | ----------------------- |
| `.claude/skills/audit/SKILL.md` | All four sections above |

## Out of Scope

- Phase 2 discovery agents: kept as-is (they have accumulated OCRecipes-specific knowledge through Phase 7/8 codification cycles and are worth preserving)
- Manifest template: no changes needed
- CHANGELOG format: no changes needed
- Parallel worktree dispatch for Phase 3 fixes: assessed and rejected — sequential per-fix tracking is more valuable than speed for audits; isolation (Section 1) solves the actual pain point
