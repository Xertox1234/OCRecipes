---
title: "Merge review gate: require a clean code-reviewer record, not just any clean record"
status: backlog
priority: medium
created: 2026-10-31
updated: 2026-10-31
assignee:
labels: [deferred, harness]
github_issue:
---

# Merge review gate: require a clean code-reviewer record, not just any clean record

## Summary

`merge-review-guard.sh` lets a merge through on **any single** clean (or advisory) review record whose digest matches the PR's files, whatever reviewer wrote it. A review set that left out `code-reviewer` — the #1622 baseline skip — can therefore still merge. Make the gate require that the matching clean record come from `code-reviewer`.

## Background

- **Where it came from.** This gap was named, deliberately out of scope, in N4 (#1644, the `review-dispatch` mod). Owner asked for it as a todo, 2026-10-31.
- **What N4 already enforces.** The mod refuses a domain reviewer until `code-reviewer` was dispatched for the same HEAD. It only runs in sessions that load it (via `CLAUDE_CODE_PLUGIN_DIRS` on the owner's laptop), and it enforces at **dispatch**. It does not reach cloud sessions, sessions without the mod, or hand-run reviews.
- **Why the gate is the place to close it.** It is fail-closed and runs on both merge routes.
- **How the gate behaves today.** The record loop never filters `agent_type`; `docs/AI_WORKFLOW.md` → "Confirmation pass" states this as intended ("One reviewer is enough").
- **Why this won't cost an extra review.** Every pipeline already ends with a `code-reviewer` record at final head. In `/todo`, the executor's Step 10 confirmation pass is a `code-reviewer`. For other PRs, `code-reviewer` is the always-dispatched baseline.
- **Owner ruling.** Harness changes are frozen only when they add CI time (owner ruling 2026-10-30). This adds a few hook-test cases, measured in milliseconds.
- **Filed as a todo at the owner's request.** Normally a finding against `.claude/hooks/**` goes to `docs/harness-residuals.md`.

## Acceptance Criteria

- [ ] The guard allows a merge only when a record that is digest-matching, clean or advisory, and has `unresolved` empty **also** has `agent_type: code-reviewer`.
- [ ] A digest-matching clean record from a domain reviewer alone is **denied**. The deny message names the missing `code-reviewer` record and how to recover: dispatch `code-reviewer` at the final head with `pr=<N>`.
- [ ] Tests in `.claude/hooks/test-merge-review-guard.sh` cover: code-reviewer clean → allow; domain-only clean → deny; code-reviewer `findings` plus domain clean → deny. Each case gets a control, so the new deny case fails against the old guard.
- [ ] `docs/AI_WORKFLOW.md` → "Confirmation pass" ("One reviewer is enough… never filters `agent_type`") and the `land` skill's review-gate text are updated to say the record must be `code-reviewer`'s.
- [ ] Run once against the real `review_stamp_dir` of a recently merged PR, to show an existing `code-reviewer` record still passes.

## Implementation Notes

- The record loop is in `.claude/hooks/merge-review-guard.sh`, around lines 680–760: the verdict block reads `.verdict` and `.unresolved`, and `WHO` already reads `.agent_type`. Add the `agent_type` condition to the **allow** match. Do not use it to skip records before their verdict is read: a `findings` record from any reviewer must still deny. The comments at ~L706 explain why that ordering matters.
- `agent_type` is written by `.claude/hooks/review-stamp-writer.sh` from the SubagentStop payload. Check that a `code-reviewer` dispatched as a **nested** subagent (the executor's reviewers) records `agent_type: code-reviewer` exactly. Look at an existing record under `review_stamp_dir`.
- Read `MEMORY-reference.md` → "Guard-work lessons" first. Narrowing or widening a deny predicate needs both versions measured.

## Scope Contract

- **Mechanisms to use:** the existing record loop and `agent_type` field. Nothing new.
- **Files in scope:** `.claude/hooks/merge-review-guard.sh`, `.claude/hooks/test-merge-review-guard.sh`, `docs/AI_WORKFLOW.md` (Confirmation pass paragraph), `.claude/skills/land/SKILL.md` (review gate text).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. #1644 is merged.

## Risks

- **A lone domain-reviewer clean record stops being enough.** A PR whose only record at final head is from a domain reviewer would now be denied at merge. That is the point of the change, but the deny message must give the recovery step.
- **The emergency escape is unchanged.** `SKIP_MERGE_REVIEW=1` still bypasses the whole gate.

## Updates

### 2026-10-31

- Initial creation, from the N4 known gap (PR #1644), at the owner's request.
