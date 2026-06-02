---
title: "Remove dead `if (!res.ok)` guards after apiRequest across hooks"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, code-quality]
github_issue:
---

# Remove dead `if (!res.ok)` guards after apiRequest

## Summary

`apiRequest()` always throws on non-ok before returning (`query-client.ts:186`), so every `if (!res.ok) { ... throw ... }` block that follows an `apiRequest(...)` call is unreachable dead code. Remove them across ~10 hook files (~30 sites).

## Background

The one instance with live user impact (`useCookbooks` 409 → "Already Saved") was already fixed in the 2026-05-31 code-quality re-run (manifest M5). This todo covers the remaining purely-dead guards (L1) — no runtime impact, but they mislead readers into thinking non-ok responses are handled inline.

## Acceptance Criteria

- [ ] Remove dead `if (!res.ok)` blocks following `apiRequest` in: `useCookbooks.ts:16,30,47-50,72-75`; `useMealPlan.ts:29,48,86,107`; `usePantry.ts:10,21,40,71`; `useRecipeSearch.ts:28`; `useMealPlanRecipes.ts:64,75,114,145,161,188,209`; `useGroceryList.ts:13,27,48,80,148,199`; `useCarouselRecipes.ts:29,44`; `useHistoryData.ts:80,119`
- [ ] Do NOT touch guards that follow a raw `fetch`/`uploadAsync` (those are LIVE): `useSavedItems.ts:55`, `useCookSession.ts:88`, `useReceiptScan.ts:115`, `useMenuScan.ts:43`
- [ ] `useRecipeSearch.ts:32` parsed-body-validation `ApiError` throw is LIVE — keep it
- [ ] All existing tests pass; no behavior change expected

## Implementation Notes

- Each site: confirm the line directly above the guard is `const res = await apiRequest(...)` (not `fetch`). The 2026-05-31-code-quality-r2 manifest L1 lists each verified site.
- After removing the guard the mutationFn typically reduces to `return res.json();`.

## Risks

- Low — dead code by construction. The only behavioral risk is mistaking a raw-`fetch` guard for an `apiRequest` one; the exclusion list above is verified.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest finding L1. The live-defect sibling (M5) was fixed in the same audit.
