---
title: "Explore why todo-executors diverge on the same situation (.env, scope growth, filing, review-stamp handling)"
status: in-progress
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
- [x] A decision on `.env` for `Agent(isolation)` worktrees: provision it the way `post-checkout`
      does, forbid linking it and leave DB tests to CI, or something else — recorded where
      executors will read it.
- [x] The #1039 leading-zero commit hash explained (how it was produced) or ruled harmless.
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
  `docs/AI_WORKFLOW.md` (read, and edit only once decisions are made), and
  `.claude/agents/todo-researcher.md` (same stale LSP warm-up; added with user approval 2026-09-24). `.claude/hooks/**` is
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
- **Findings (transcript-measured: sessions `d398476e` = 10 executors on 2026-09-24,
  `ed41adb3` = 5 on 2026-09-23, `3d6c7d6c` = 14 on 2026-09-23):**
  - **Stalls mid-review = an instruction defect, not divergence.** The `Agent` tool runs a
    subagent in the BACKGROUND unless `run_in_background: false` is passed. Step 6 (reviewers),
    the Step 7 confirmation pass and the Step 3 researcher dispatch never say so, and Step 5b
    wrongly says "the turn simply completes once every call in it — agents and Bash alike — has
    returned." In `d398476e`, all 5 executors that got a `[handback-send-enforce]` nudge
    had just launched a reviewer that came back as `Async agent launched` and then wrote "I'll wait for its
    completion notification". Of the 5 that did not stall, 3 passed `run_in_background: false`
    on some dispatches; the other 2 were not examined. Positive control: dispatches that passed
    `false` came back as a synchronous `SubagentHandback`.
  - **LSP "not working" has two causes.** (a) `3d6c7d6c`: 14/14 executors got
    `ToolSearch select:LSP` → "No matching deferred tools… `ide`: WebSocket is not open" — the
    tool was absent for the whole session (IDE connection), and the documented fallback ran as
    written. (b) `d398476e`/`ed41adb3`: the mandatory warm-up target is STALE —
    `client/constants/theme.ts:210:17` is now inside a style literal (`withOpacity` moved to
    line 254). It returns "No hover information" even on a warm server (reproduced
    2026-09-24; 254:17 returns the signature, also on a worktree path). All 15 executors saw their
    warm-up "fail". Same stale coordinate in `.claude/agents/todo-researcher.md:48`.
  - **`.env`:** `.husky/post-checkout` does not fire for `Agent(isolation:"worktree")`
    worktrees (`core.hooksPath` is set to `.husky/_`, so the harness's worktree creation is
    what skips it — not fixable in-repo). 8/10 executors in `d398476e` hand-ran
    `ln -s <main>/.env`. Coupling: "forbid linking, leave DB tests to CI" is NOT viable on its own —
    `preflight:fast` gates on `pg_isready` (server up), not `DATABASE_URL`, so
    `vitest related` runs, the DB suites fail, and the pre-push gate refuses the push.
  - **#1039 hash `0000036a…`:** `git cat-file -p` shows ordinary headers (no extra header,
    author == committer timestamp, ordinary message) — no sign of hash mining; ruled harmless
    chance.
  - Divergences 2, 3, 4, 5 (scope growth, filing, stamp reporting, research skip) not yet
    investigated.
- **Decisions (user, 2026-09-24) — applied in `todo-executor.md` (+ `todo-researcher.md`,
  user-approved beyond the Scope Contract):**
  - `.env`: Step 0 runs `sh .husky/post-checkout 0 0 1` (the repo's own provisioning, symlinks
    only). On denial, the executor does not work around it and reports "DB tests unverified locally".
    Probed on a hook-less throwaway worktree: `.env` absent → symlink to the main checkout.
  - Stalls: every executor `Agent()` dispatch passes `run_in_background: false` (researcher,
    Step 6 reviewers, Step 7 confirmation pass); Step 5b's false "turn completes" claim corrected.
  - LSP warm-up: a throwaway `hover` warms the server (position arbitrary), then a
    line-independent `workspaceSymbol("withOpacity")` checks it. An empty answer means cold (retry the pair
    once); only a `ToolSearch` miss means unavailable. (Review measured that `workspaceSymbol` alone
    does not warm a cold server; a `hover` does.)
  - Instruction edits load on session reload, so they are unverified until the next `/todo` run.
    Check it for zero `[handback-send-enforce]` nudges and zero `Async agent launched` results
    in executor transcripts.
