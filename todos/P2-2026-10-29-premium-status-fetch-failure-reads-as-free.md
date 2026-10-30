---
title: "A paying user whose subscription-status fetch fails is treated as free"
status: backlog
priority: medium
created: 2026-10-29
updated: 2026-10-29
assignee:
labels: [deferred, client, iap]
github_issue:
human_led: true
blocked_reason: "Premium/IAP gating — owner decides optimistic vs neutral behaviour; never autonomously dispatched"
---

# A paying user whose subscription-status fetch fails is treated as free

## Summary

`PremiumContext` defaults to the free tier whenever `/api/subscription/status` has no data, and most gates read `isPremium` without `isPremiumResolved`.

## Background

Audit finding M-crel-6. `client/context/PremiumContext.tsx` (~121-136). Only `ChatStackNavigator.tsx` and `QuickLogScreen.tsx` check `isPremiumResolved`; `ReceiptCaptureScreen`, `RecipeDetailContent`, `useHistoryData`, `HistoryItemActions`, `SavedItemsScreen`, `RecipeBrowserScreen`, `AskCoachSection` gate on `!isPremium` alone. A 429/5xx with no persisted copy inside the 24 h maxAge shows paywalls to a paying user. Premium/IAP-adjacent, so a human leads it.

Found by the 2026-10-29 pre-launch audit (manifest `docs/audits/2026-10-29-pre-launch.md`, local-only); deferred from the unattended overnight run because it needs a decision or verification that run could not make.

## Acceptance Criteria

- [ ] Gates distinguish "not premium" from "premium status unknown" (loading or failed) and do not show an upgrade wall while unknown
- [ ] A failed status fetch shows a retryable state where the gate matters
- [ ] Tests cover failed-status for at least two gates

## Implementation Notes

Decide first whether "unknown" should allow (optimistic) or show a neutral state; then apply consistently.

## Scope Contract

- **Files in scope:** `client/context/PremiumContext.tsx` and the gate call sites listed above, with tests
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-29

- Initial creation (pre-launch audit, overnight run)
