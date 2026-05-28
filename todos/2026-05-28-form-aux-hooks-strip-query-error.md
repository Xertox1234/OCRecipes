---
title: "useDietaryProfileForm and useQuickLogSession strip read-query error from their return"
status: backlog
priority: low
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [deferred, hooks, client-state, error-handling]
github_issue:
---

# useDietaryProfileForm and useQuickLogSession strip read-query error from their return

## Summary

Follow-up from the `useProfileData`/`useHistoryData` query-error exposure work
(`todos/archive/2026-05-28-data-hooks-hide-query-error.md`). The audit (AC #4 of
that todo) found two more hooks in the same `NO-ERR-REF` class: they destructure
`data`-only from a read query and build a custom return object that omits
`isError`/`error`, so consumers cannot render a failure state for that fetch.

## Background

Surfaced during the 2026-05-28 silent-failure investigation. Hooks that
`return useQuery(...)` directly (or spread `...query`) already expose error
fields and are fine (e.g. `useCatalogSearch`, `useRecipeSearch`, `useDailyBudget`,
`useMicronutrients`, `useCuratedRecipes`). The risk is only hooks that build a
**custom return object literal** from a destructured query.

Two such hooks remain:

- **`useDietaryProfileForm`** (`client/hooks/useDietaryProfileForm.ts:51`,
  return at line 148): `const { data: profile, isLoading } = useQuery<DietaryProfile>(...)`.
  The return exposes `isLoading` and the mutation's `saveError`, but NOT the
  profile **read** query's `isError`/`error`. The form (EditDietaryProfile)
  cannot tell the user the profile failed to load — it just renders empty
  fields. Non-trivial: this is the primary read for a full settings screen.
- **`useQuickLogSession`** (`client/hooks/useQuickLogSession.ts:258`, return at
  line ~317): `const { data: frequentItems } = useQuery(...)`. The return exposes
  `frequentItems` but no error for that query. Lower-impact: `frequentItems`
  feeds optional suggestion chips, so a silent failure degrades to "no chips"
  rather than a broken core flow.

## Acceptance Criteria

- [ ] `useDietaryProfileForm` exposes the profile read query's `isError`/`error`
      (and ideally `refetch`) in its return object, distinct from the existing
      `saveError`.
- [ ] The EditDietaryProfile consumer renders an error/retry state when the
      profile read fails (mirror the `query-error-retry-pattern` solution).
- [ ] Decide whether `useQuickLogSession`'s `frequentItems` error warrants
      exposure; if the suggestion chips silently degrading is acceptable, note
      that explicitly and close the item.

## Implementation Notes

- Mechanical, additive fix identical to the parent todo: thread `isError`/
  `error`/`refetch` through the destructure and return, then handle at the
  consumer. Additive return fields, low blast radius.
- Do NOT add `meta: { silentError: true }` without first `findReferences` on the
  query key — see `docs/rules/client-state.md` and
  `docs/solutions/logic-errors/shared-query-key-meta-mount-order-2026-05-28.md`.
  `useDietaryProfileForm` reads `QUERY_KEYS.dietaryProfile`, which is shared with
  `CoachRemindersScreen` and `RecipeChatScreen` — the mount-order solution
  explicitly lists it as a "don't opt out" key. Accept the toast + inline
  double-report instead.
- LSP-first: `findReferences` each hook before changing its return shape.

## Dependencies

- None blocking. Independent of the parent todo (already implemented).

## Risks

- Low. Additive to return objects; consumers opt in.

## Updates

### 2026-05-28

- Initial creation from the AC #4 audit of the parent data-hooks todo.
