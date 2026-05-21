---
title: "Validate receipt-scan hook responses with Zod at the network boundary"
status: done
priority: low
created: 2026-05-20
updated: 2026-05-20
assignee:
labels: [deferred, client-state, typescript]
github_issue:
---

# Validate receipt-scan hook responses with Zod at the network boundary

## Summary

`useReceiptScan` / `useReceiptConfirm` return `response.json()` cast straight to
`ReceiptAnalysisResult` / `ReceiptConfirmResult` with no runtime validation, and
read `errorData.error` off `any`. Add Zod schemas validated at the boundary,
mirroring the recipe-search/catalog hook pattern.

## Background

Found in the 2026-05-20 full audit (L6). The 2026-05-16 Zod-response-validation
pass covered only `useRecipeSearch`/`useCatalogSearch`; the receipt hooks were
not in scope then. Same fail-closed boundary-validation rule applies
(`docs/rules/typescript.md`). Docs-researcher (2026-05-20) verdict: **better-fix**
— use `.safeParse()` (or `.parse()` inside the `mutationFn`, which TanStack Query
already wraps in try/catch) per zod.dev/basics.

## Acceptance Criteria

- [ ] `receiptAnalysisResultSchema` + `receiptConfirmResultSchema` defined (Zod)
- [ ] Both hooks validate `await response.json()` before returning
- [ ] `errorData` typed as `{ error?: string }` (no `any` read)
- [ ] A malformed-shape response surfaces a domain error, not a silent bad cast

## Implementation Notes

Files: `client/hooks/useReceiptScan.ts` (lines 72, 78, 103, 106). Pattern
reference: the recipe-search hook's `recipeSearchResponseSchema`. Both calls live
inside `mutationFn`, so `.parse()` works (Query catches the throw) — `.safeParse()`
with an explicit `throw new Error(...)` gives a cleaner message.

## Risks

- Schema must match the real server response shape — derive it from the route's
  response type to avoid false rejections.

## Updates

### 2026-05-20

- Initial creation (deferred from 2026-05-20 full audit, finding L6; research
  verdict better-fix).
