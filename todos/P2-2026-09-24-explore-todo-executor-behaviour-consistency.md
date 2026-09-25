---
title: "Explore why todo-executors diverge on the same situation (.env, scope growth, filing, review-stamp handling)"
status: in-progress
priority: medium
created: 2026-09-24
updated: 2026-09-25
assignee:
labels: [deferred, harness, investigation]
github_issue:
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

- [x] For each divergence above, the behaviour the user wants is decided (user, 2026-09-25 — see
      Updates). What remains is applying those decisions to the instructions:
- [x] **Scope (2): grow only when needed.** Every place that states the "out-of-contract =
      CRITICAL" rule stops treating every out-of-contract file as CRITICAL: `todo-executor.md`
      Step 4 item 6 and the Step 6 item-3 reviewer-prompt append, the rule's source
      `docs/AI_WORKFLOW.md` → Tier handling ("Scope-contract violation = CRITICAL"), and the
      scope-contract checklist item in `.claude/agents/code-reviewer.md`. The Step 10 item-7b
      confirmation pass inherits the change through `docs/AI_WORKFLOW.md`, so no disclosed file
      is blocked there either. An executor may
      touch a file outside the Scope Contract only when an acceptance criterion cannot be met
      without it, and must list each such file under an "Out of contract" heading in the PR body
      with a one-line reason. An undisclosed out-of-contract file, or one not needed for an
      acceptance criterion, stays CRITICAL.
- [x] **Follow-ups (3): report only.** Executors never create a todo file, for any finding (not
      just review WARNINGs). Every side problem goes into the Step 11 report under
      `DEFERRED_WARNINGS`; the user decides what becomes a todo. Say so once, where filing is
      discussed (Step 7), without restating it elsewhere.
- [x] **Review stamp (4a): accept `advisory`.** Done in #1061 (`e48b9147`): the Step 10 7c
      check accepts `clean` OR `advisory` with zero unresolved, prints `"<verdict> <agent_type>"`,
      and `REVIEW_STAMP:` gained an `advisory at <sha>` form. Do not redo this.
- [x] **Review stamp (4b): report `advisory` honestly.** What #1061 left: say in Step 10 7c (once)
      that `REVIEW_STAMP:` copies the verdict word from the `MATCH` line and never reports an
      `advisory` record as `clean`, and that the advisory review's WARNING/SUGGESTION notes go into
      `DEFERRED_WARNINGS` (extend that field's description in the Step 11 template to cover them).
- [x] **Research (5): follow the rule.** The researcher is skipped only on the existing
      Short-circuit gate or Lightweight path. Add one sentence saying no other skip (e.g. "small
      scope") is allowed, and that the skip reason is recorded in `SHORT_CIRCUIT`.
- [x] A decision on `.env` for `Agent(isolation)` worktrees: provision it the way `post-checkout`
      does, forbid linking it and leave DB tests to CI, or something else — recorded where
      executors will read it.
- [x] The #1039 leading-zero commit hash explained (how it was produced) or ruled harmless.
- [x] No `.claude/hooks/**` edit is needed for any item above; if one turns out to be, log it in
      `docs/harness-residuals.md` per the harness freeze instead of editing the hook.

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
  `.claude/agents/todo-researcher.md` (same stale LSP warm-up; added with user approval 2026-09-24), and
  `.claude/agents/code-reviewer.md` (its scope-contract checklist item only; added 2026-09-25 for
  decision 2). `.claude/hooks/**` is
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

### 2026-09-25

- **Decisions (user) on the four remaining divergences:** (2) scope may grow only when an
  acceptance criterion needs it, and every extra file is disclosed in the PR; (3) executors report
  side problems and never file todos; (4) an `advisory` stamp counts as a pass but is reported as
  `advisory`, never `clean`; (5) the researcher is skipped only where the existing rules allow.
  Divergence 6 (background waits) was covered by the 2026-09-24 `run_in_background: false`
  decision; 7 was ruled harmless. Gate removed and status reset to `backlog`; the remaining work
  is instruction edits, ready for `/todo`.
- **Reconciled with #1061 (merged `e48b9147`):** that PR already made the 7c check accept an
  `advisory` record and added the `advisory at <sha>` report form, so AC (4) is split: (4a) is
  done, and (4b) keeps only the "never report it as clean" sentence and the `DEFERRED_WARNINGS`
  wiring.

### 2026-09-25 (implementation)

- Applied the four remaining decisions as instruction edits. All are docs-only (`.claude/agents/`,
  `docs/AI_WORKFLOW.md`, `.claude/skills/todo/SKILL.md`) — no `.claude/hooks/**` change was
  needed for any of them.
  - **Scope (2):** `todo-executor.md` Step 4 item 6 (and the new item-7 tracking clause), the
    Step 6 item-3 reviewer-prompt append, `docs/AI_WORKFLOW.md` → Tier handling, and
    `.claude/agents/code-reviewer.md`'s scope-contract checklist item all now carry the
    disclosed-exception carve-out (needed for an AC + listed under a PR-body "Out of contract"
    heading with a reason that holds up). Added the "Out of contract" section to Step 10's PR
    body template, since the rule has nowhere to land without it. Swept the repo for every other
    "scope contract"/"out-of-contract" mention (`grep -rln` over `.claude/`, `docs/`, `todos/`) —
    the only other hit that states the rule normatively (vs. referencing the concept) is
    `todos/TEMPLATE.md`'s comment, which just points to `docs/AI_WORKFLOW.md` → Tier handling and
    needed no edit since it doesn't restate the rule's detail. Everything else is either a solved
    todo/solution file referencing the concept historically, or a per-todo Scope Contract section
    (not a rule statement).
  - **Follow-ups (3):** Step 7 now states once, up front, that the no-filing rule is global (any
    side finding, not just review WARNINGs) and that it is intentionally not restated elsewhere.
  - **Review stamp (4b):** Step 10 item c now says to copy the verdict word straight from `$MATCH`
    into `REVIEW_STAMP:` and never round `advisory` up to `clean`, and that an advisory record's
    WARNING/SUGGESTION notes go into `DEFERRED_WARNINGS`. Widened the Step 11 `DEFERRED_WARNINGS`
    field description to name that source explicitly.
  - **Research (5):** added one sentence after the researcher dispatch block stating the
    Lightweight path and the Short-circuit gate are the _only_ two grounds to skip the researcher,
    and that the skip reason (or "researcher dispatched") is recorded in `SHORT_CIRCUIT`. Extended
    `SHORT_CIRCUIT`'s Step 11 field description with the new `lightweight — docs/config-only
files` value (a `docs/solutions` path and `none` already existed), and synced the two SKILL.md
    mentions of that field (Phase 4 recording + the Phase 5 "Short-circuited: SC" tally, which now
    clarifies it counts only the verified-solution form, not a lightweight skip).
  - This todo (`docs/`, `.claude/agents/`, `.claude/skills/` only, all `.md`) qualified for the
    Lightweight path itself — the `todo-researcher` dispatch was skipped per that rule, consistent
    with the AC (5) it implements.
  - Left as a `DEFERRED_WARNING` rather than fixed here (out of this todo's Scope Contract): this
    session's `Agent` tool schema has no `run_in_background` parameter
    (`additionalProperties: false`), while `todo-executor.md` (Steps 3, 5b, 6, 10) instructs every
    `Agent()` dispatch to pass `run_in_background: false` per the 2026-09-24 stall-prevention
    decision. Not re-litigated here since that decision predates and is outside this run's four
    acceptance criteria; flagged for whoever next touches those steps.
