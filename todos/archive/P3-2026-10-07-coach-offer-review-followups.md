---
title: "Coach recipe offer: review follow-ups from PR #1330"
status: done
priority: low
created: 2026-10-07
updated: 2026-10-09
assignee:
labels: [deferred, coach, recipe-finder]
github_issue:
---

# Coach recipe offer: review follow-ups from PR #1330

## Summary

Two small non-blocking suggestions from the PR #1330 review. Both are flag-gated and both are cosmetic.

## Background

PR #1330 added the server side of the Coach Pro recipe offer flow. Two of its four reviewers (AI and server) independently raised the first item. The code reviewer raised the second. Per the one-review-pass rule, these were deferred rather than fixed on the reviewed branch.

## Acceptance Criteria

- [x] **Lead text kept on "repeat = yes".** In the `adjust` branch of `deliverOfferToolCall` (`server/services/coach-pro-chat.ts` ~597), keep the model's pre-tool `leadText` and `leadBlocks`. Pass them into `runCoachFinderTurn` and prepend them to the saved message, the way the `offer` and `repost_adjust` branches do with `withLead`. Also make the docblock (~576) accurate.
- [x] **Unused `offer` input removed or documented.** The `{ kind: "offer"; dish; details }` `FinderInput` variant (`server/services/recipe-finder/transition.ts` ~33) has no production caller. Its comment says the Coach tool path builds it, but `deliverOfferToolCall` calls `buildOfferBlock` directly. Either remove the variant and its planner/executor branches, or reword the comment to say it is unused plumbing.
- [x] Tests cover the lead-text case: a saved row contains the lead.

## Implementation Notes

- The lead text only appears when the model ignores the tool description's "call it without any other text".
- With `RECIPE_OFFER_ENABLED` off, nothing changes.

## Scope Contract

- **Mechanisms to use:** the existing `withLead` helper and the `CoachFinderTurnParams` type. Nothing new.
- **Files in scope:**
  - `server/services/coach-pro-chat.ts`
  - `server/services/recipe-finder/coach-turn.ts`
  - `server/services/recipe-finder/transition.ts`
  - `server/services/recipe-finder/run-turn.ts`
  - their `__tests__` files
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #1330 (merged)

## Risks

- Low. The behaviour is flag-gated.

## Updates

### 2026-10-07

- Initial creation, from the PR #1330 review.

### 2026-10-09

- Done on `fix/coach-offer-server-followups`. The repeat=yes (`adjust`) branch now passes `leadText`/`leadBlocks` into `runCoachFinderTurn`, which saves and yields them ahead of the adjust card. `withLead` moved into `coach-turn.ts` as an export, because `coach-pro-chat.ts` already imports that module.
- The unused `offer` `FinderInput` variant was removed, along with its `FinderStep` and its planner, executor, outcome and status-label arms.
- New test: "repeat = yes keeps streamed pre-tool text as the adjust message's lead line" in `coach-pro-chat.test.ts`. It was red before the fix.
- The same branch also fixed the 17 extra deferred notes from the #1330 review.
