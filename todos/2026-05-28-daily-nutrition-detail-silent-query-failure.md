---
title: "DailyNutritionDetailScreen shows confident wrong '0 consumed' data on partial query failure"
status: backlog
priority: high
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, data-integrity]
github_issue:
---

# DailyNutritionDetailScreen shows confident wrong "0 consumed" data on partial query failure

## Summary

When `/api/daily-summary` fails but `goals`/`budget` are cached or succeed, the screen renders a full CalorieRing at **0 consumed / "0 items logged today"** against a real goal, with no error — presenting a network failure as legitimate zero-intake data.

## Background

Surfaced during a silent-failure investigation prompted by an unsolicited user report ("app works except when it doesn't, and when it doesn't it fails quietly"). For a nutrition tracker, silent _wrong_ data is worse than a blank screen because nothing looks broken — the user trusts a false "you've eaten nothing today."

Structural root cause for this whole class: the query client has no global error net (`client/lib/query-client.ts:124` — no `QueryCache`/`MutationCache` `onError`), so each screen must surface its own errors and this one doesn't.

## Acceptance Criteria

- [ ] When any of the daily-summary / goals / budget queries error, the screen shows a distinct error state (with retry), not zero-defaulted data.
- [ ] A failed `/api/daily-summary` no longer renders "0 items logged today" / 0 consumed against a real goal.
- [ ] Loading, error, and genuinely-empty (no items logged yet today) are visually distinguishable.

## Implementation Notes

- File: `client/screens/DailyNutritionDetailScreen.tsx`
- Lines 113-120: the `budget` / `summary` / `goals` queries destructure only `data` + `isLoading`; also capture `isError`/`error`.
- Line 123: `isLoading` is the only render gate — add an error gate before the zero-defaulting at lines 125-131.
- Lines 188-214: CalorieRing, "remaining calories", and itemCount must not present defaulted zeros as real data on error.
- `useDailyBudget` already returns the full query result (`client/hooks/useDailyBudget.ts:11`), so its error is available; the two inline `useQuery` calls (daily-summary, goals) just need their error read.

## Dependencies

- None hard. A global `QueryCache.onError` net (`client/lib/query-client.ts:124`) would address this and the sibling findings app-wide — consider bundling, but this todo stands alone.

## Risks

- Zero is a legitimate value (user genuinely hasn't eaten yet). The fix must differentiate true-empty (200 with empty payload) from error-empty, or a fresh-day user will see a false error.

## Updates

### 2026-05-28

- Initial creation. Finding verified by reading lines 113-135 and 188-214.
