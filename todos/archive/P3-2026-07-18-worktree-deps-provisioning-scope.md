---
title: "worktree-deps.sh provisions only .claude/worktrees/* — decide scope for .worktrees/ (audit) trees"
status: done
priority: low
created: 2026-07-18
updated: 2026-07-18
assignee:
labels: [deferred, harness, worktrees]
github_issue:
---

# worktree-deps.sh provisions only `.claude/worktrees/*` — decide scope for `.worktrees/` (audit) trees

## Summary

`worktree-deps.sh` symlinks `node_modules` (+ `docs/LEARNINGS.md`) only into worktrees under `$MAIN_ROOT/.claude/worktrees/`, while the `/audit` skill creates its worktree under `.worktrees/` — so audit worktrees get `.env*` (via `.husky/post-checkout`) but no `node_modules`, and the skill's Phase 1 baseline (`npm run test:run` in-worktree) fails until a manual symlink. Decide whether the hook should cover `.worktrees/` (or all linked worktrees), or whether skills own their provisioning.

## Background

Found by the 2026-07-18 harness audit (finding M5, manifest `docs/audits/2026-07-18-harness.md`) and hit live during the same audit's fix phase (manual `ln -s` required). A stopgap note was added to `.claude/skills/audit/SKILL.md` Phase 1 step 3 instructing the manual symlink — remove or simplify it once the real decision lands. Related stale memory (`project_worktree_provisioning`) was corrected in the same audit: post-checkout owns `.env*`, worktree-deps owns `node_modules`.

## Acceptance Criteria

- [x] Decision recorded: widen `worktree-deps.sh` to `.worktrees/*` (or any linked worktree with a `package.json`), or keep the restriction and make each skill self-provision
- [x] If widened: `.claude/hooks/test-worktree-deps.sh` covers the `.worktrees/` case
- [x] The stopgap symlink note in `.claude/skills/audit/SKILL.md` Phase 1 step 3 updated/removed to match
- [x] Memory `project_worktree_provisioning` stays accurate

## Implementation Notes

- Restriction lives at `.claude/hooks/worktree-deps.sh:35-53` (path predicate on `$MAIN_ROOT/.claude/worktrees/` + `package.json` presence).
- Consider why the restriction exists (executor-managed trees are known-disposable; a blanket rule would also touch user-created ad-hoc worktrees) before widening — the conservative widening is exactly the two harness-managed roots: `.claude/worktrees/*` and `.worktrees/*`.
- Triggers: SessionStart + PostToolUse `EnterWorktree` — a worktree created mid-session via plain `git worktree add` gets provisioning only on the next trigger; the audit skill's flow relies on entering via Bash, so the stopgap symlink may still be needed unless the hook is also invoked from the skill.

## Scope Contract

- **Mechanisms to use:** the existing `worktree-deps.sh` hook + its self-test — no new provisioning scripts
- **Files in scope:** `.claude/hooks/worktree-deps.sh`, `.claude/hooks/test-worktree-deps.sh`, `.claude/skills/audit/SKILL.md`, memory notes
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- Widening to all linked worktrees could symlink `node_modules` into a user's manually created worktree where they intended a clean install.

## Updates

### 2026-07-18

- Initial creation from harness-audit finding M5 (deferred at triage: design decision).

### 2026-07-19

- **Decision: widen.** `worktree-deps.sh`'s path predicate (line 44) now covers both harness-managed roots — `.claude/worktrees/*` and `.worktrees/*` — not every linked worktree (the Risk section's concern about a user's ad hoc worktree wanting a clean install still holds).
- Widening the predicate alone does not fully close the audit gap: `/audit` creates its worktree via plain Bash `git worktree add` + `cd` mid-session, so neither `SessionStart` nor `PostToolUse:EnterWorktree` fires. `.claude/skills/audit/SKILL.md` Phase 1 step 3's stopgap note was converted (not deleted) to an explicit `bash .claude/hooks/worktree-deps.sh` invocation run from inside the fresh worktree.
- `.claude/hooks/test-worktree-deps.sh` gained two new cases: a `.worktrees/*` tree gets symlinked, and a worktree outside both roots does not.
- `project_worktree_provisioning` memory updated to reflect the widened predicate, the explicit-invocation fix for the audit trigger gap, and a distinct pre-existing bug that bit all three `/todo` executor worktrees this run (two siblings plus this todo's own): the symlink guard `[ ! -e "$path/node_modules" ]` (worktree-deps.sh:53) skips symlinking whenever ANY `node_modules` dir already exists, including a near-empty one from a test runner's own cache. That bug is outside this todo's Acceptance Criteria — surfaced here, then **RESOLVED by commit `83ddc57d` on this same PR** (orchestrator review-cycle commit): dot-entry-only `node_modules` dirs are now replaced with the shared symlink, real installs never touched, both pinned in `test-worktree-deps.sh`.
