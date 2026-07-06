<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Copilot review request races auto-merge for guard-eligible todo PRs"
status: done
priority: low
created: 2026-07-06
updated: 2026-07-06
assignee:
labels: [deferred, todo-skill]
github_issue:

---

# Copilot review request races auto-merge for guard-eligible todo PRs

## Summary

In `.claude/agents/todo-executor.md` Step 10, Step 4 (merge-eligibility check — arms
`gh pr merge --auto` on a guard pass) runs before Step 5 (request Copilot review, always
non-blocking). For a guard-eligible PR with fast-passing CI, auto-merge can land the PR
before Copilot's review has even been requested, let alone posted a comment.

## Background

Surfaced during code review of PR #525 (restore-guard-eligible-automerge). This ordering
and Step 5's non-blocking nature both pre-date that PR — Copilot review was never a merge
gate — but restoring self-merge for guard-eligible PRs means the review request can now
be entirely moot for exactly the PR class that also lost the human "morning batch-merge"
checkpoint. Not a regression (nothing that used to gate merges stopped gating), but a
minor coverage gap worth closing since the guard-eligible class is CI+guard only now, no
Copilot input either.

## Acceptance Criteria

- [x] Reorder Step 10 so the Copilot review request (current Step 5) fires before the
      merge-eligibility check / auto-merge arm (current Step 4), OR
- [ ] Confirm (and document) that requesting Copilot review before arming auto-merge has
      no meaningful race-reduction benefit given Copilot review is asynchronous anyway,
      and close this as won't-fix with that rationale

## Implementation Notes

File: `.claude/agents/todo-executor.md`, Step 10 (~lines 519-537, the merge-eligibility
check and Copilot review request steps). Swapping order is a same-file reordering, low
risk — Step 5 is already documented as non-blocking (a failure there doesn't stop Step
11 reporting), so making it run first shouldn't change failure-handling behavior.

## Dependencies

- None

## Risks

- Low — reordering two independent, already-non-blocking steps

## Updates

### 2026-07-06

- Initial creation, filed from PR #525 code review (SUGGESTION-level finding)
- Implemented: reordered Step 10 of `.claude/agents/todo-executor.md` so "Request Copilot
  review" is now sub-step 4 and "Merge-eligibility check" is now sub-step 5 (previously
  4 and 5 respectively). Updated all in-file cross-references (the step-10 intro, the
  "already-exists" fallback sub-step 6, and the two guard-eligibility bullets) to match
  the new numbering and order. Chose the reorder (AC option 1) over won't-fix: it is a
  strict improvement in the edge case where CI checks are already green by the time
  Step 10 runs (arming auto-merge first could merge/delete-branch before the review is
  ever requested at all); it does not guarantee review-completes-before-merge in the
  general case since the Copilot review request remains explicitly non-blocking, but that
  was never in scope — the reorder guarantees "requested before armed," which is the
  concrete, low-risk improvement the todo asked for.
