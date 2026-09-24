---
title: "Explore why todo-executors diverge on the same situation (.env, scope growth, filing, review-stamp handling)"
status: backlog
priority: medium
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, harness, investigation]
github_issue:
human_led: true
blocked_reason: "Exploration requested by the user for themselves — decide the desired executor behaviour first; not for autonomous /todo dispatch."
---

# Explore todo-executor behaviour consistency

## Summary

The 2026-09-23 `/todo` run dispatched five `todo-executor` agents (PRs #1035, #1036, #1038, #1039,
#1040). All five succeeded, but faced with the _same_ situation they made _different_ choices.
Explore where `.claude/agents/todo-executor.md` leaves room for that divergence and decide which
behaviour is wanted in each case.

## Background

Observed divergences in that one run:

1. **Missing `.env` (credential handling).** Every executor worktree came from
   `Agent(isolation: "worktree")`, which gets no `.env`. The front-label executor (#1036) tried to
   symlink the main checkout's `.env`, was denied by the auto-mode classifier as credential
   materialization, and stopped — it left the DB tests to CI. The multer (#1035), TalkBack (#1038)
   and icon-mock (#1040) executors each symlinked it successfully and called that a "self-heal".
   The Vite executor (#1039) did not say. Same trigger, opposite outcomes, decided by which layer
   happened to fire.
   - Clue: a plain `git worktree add` runs `.husky/post-checkout`, which prints
     `post-checkout: linked .env from main repo`. The `Agent(isolation)` path evidently skips that
     hook, which is why the gap exists at all.
2. **Scope growth vs. deferral.** The Vite executor grew a 3-file todo into 16 files (`tsconfig*`,
   `eslint.config.js`, `scripts/preflight.sh`, `scripts/coverage-ratchet.ts`). The TalkBack
   executor, facing an out-of-contract file, deferred sheet site #8 instead of expanding.
3. **Deferred findings: file vs. not file.** The front-label executor filed a new todo itself
   (`P3-2026-09-23-front-label-retake-replace-skips-scan-level.md`); the Vite executor explicitly
   chose _not_ to file the two remaining vitest configs ("fix it, don't file it"); others put
   findings only in the solution doc or `DEFERRED_WARNINGS`.
4. **Review-stamp reporting.** The Vite executor reported `REVIEW_STAMP: clean` for a record whose
   verdict was `advisory` (0 unresolved), justifying it from the guard source rather than the doc.
   The TalkBack executor's confirmation reviewer omitted the required `No blocking findings.`
   literal, so no stamp was written until a second dispatch. In #1035 only `code-reviewer`'s stamp
   was written; `security-auditor` and `server-reviewer` wrote none.
5. **Research step.** The front-label executor skipped the `todo-researcher` dispatch on its own
   judgement ("small scope") instead of following the Short-circuit gate (after Step 3a).
6. **Long background waits.** The Vite executor stopped with its own background work pending
   several times (~112 min total) before reporting.
7. **Odd commit hash.** #1039's head is `0000036a969c…` — five leading zero hex digits
   (~1 in 1M by chance). Verified real on origin; cause not investigated.

Source: the orchestrator's run record for that session and the five executor reports.

## Acceptance Criteria

- [ ] For each divergence above, a written finding: the instruction (or gap) in
      `.claude/agents/todo-executor.md` / `.claude/skills/todo/SKILL.md` that allowed it, and the
      behaviour the user wants.
- [ ] A decision on `.env` for `Agent(isolation)` worktrees: provision it the way `post-checkout`
      does, forbid linking it and leave DB tests to CI, or something else — recorded where
      executors will read it.
- [ ] The #1039 leading-zero commit hash explained (how it was produced) or ruled harmless.
- [ ] Any follow-up changes filed as separate todos (or, for `.claude/hooks/**`, logged in
      `docs/harness-residuals.md` per the harness freeze).

## Implementation Notes

- This is an exploration: output is findings + decisions, not code. Start from
  `.claude/agents/todo-executor.md` (Steps 3a, 5b, 10, 11) and `.claude/skills/todo/SKILL.md`.
- `.env` provisioning for ad-hoc worktrees lives in `.husky/post-checkout`; compare what it does
  with what an `Agent(isolation: "worktree")` worktree gets.
- Review-stamp mechanics: `docs/AI_WORKFLOW.md` → Review Policy and the merge review gate memory.
- Commit hash: `git cat-file -p 0000036a969c34363eb5adb50eb4aa8cd8fbe680` on branch
  `todo/P3-2026-09-23-vite-native-config-loader-warning` — look for unusual headers or timestamps.

## Scope Contract

- **Mechanisms to use:** reading and comparing existing executor instructions and hooks; no new
  gates.
- **Files in scope:** `.claude/agents/todo-executor.md`, `.claude/skills/todo/SKILL.md`,
  `docs/AI_WORKFLOW.md` (read, and edit only once decisions are made). `.claude/hooks/**` is
  frozen — findings there go to `docs/harness-residuals.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Related: `todos/P2-2026-09-20-todo-executor-commits-after-review-so-no-pr-is-stamp-clean-at-head.md`
  (another executor-behaviour defect; currently stuck at `in-progress`).

## Risks

- Tightening executor instructions can add process weight to every future `/todo` run — prefer
  deleting ambiguity over adding rules.

## Updates

### 2026-09-24

- Initial creation, from the 2026-09-23 `/todo` run observations.
