---
title: "Share the 'couldn't verify allergens' flag shape (now duplicated in 3 places)"
status: backlog
priority: low
created: 2026-07-21
updated: 2026-07-21
assignee:
labels: [deferred, client, server, allergen, safety, maintainability]
github_issue:
---

# Share the "couldn't verify allergens" flag shape

## Summary

The fail-dangerous "couldn't verify allergens" `ScanFlag` (kind
`allergen-unavailable`, severity `warn`, tier `safety`) is now hand-authored as
an object literal in **three** places, with the same `id`/`kind`/`severity`/`tier`
but slightly different copy:

- `server/services/scan-flags.ts` — `ALLERGEN_UNAVAILABLE_FLAG` (module-private,
  not exported) and `PROFILE_UNAVAILABLE_FLAG` (exported).
- `client/hooks/useNutritionLookup.ts` — the direct-OFF fallback branch.
- `client/hooks/useNutritionLookup.ts` — the total-outage outer `catch` (added
  when closing the total-outage fail-open, PR #679).

## Background

Surfaced by the `/code-review` of PR #679 (finding #7). Closing the total-outage
fail-open added a third copy, so the drift risk is now concrete: renaming the id
(e.g. away from `"allergen-unavailable"`), changing the severity, or editing the
copy in one place silently diverges the surfaces.

## Acceptance Criteria

- [ ] A single shared factory (or set of constants) in `@shared/types/scan-flags`
      produces the `allergen-unavailable` flag, parameterized by the detail
      string (server "we don't have allergen data" vs. client "we couldn't reach
      our service" are legitimately different messages — keep both, but derive
      `id`/`kind`/`severity`/`tier` from one place).
- [ ] Server `scan-flags.ts` and both client spots in `useNutritionLookup.ts`
      use the factory; no more hand-authored literals for this flag.
- [ ] Existing tests still green; the shared factory has a focused unit test.
- [ ] `safety`-labeled → individual human review; never auto-merge.

## Implementation Notes

- `ScanFlag`/`ScanFlagKind` already live in `@shared/types/scan-flags`, so the
  factory belongs there (importable by both server and client).
- Keep `PROFILE_UNAVAILABLE_FLAG` (server-only, distinct copy) either as a second
  factory call or its own export — don't over-unify the two distinct messages.
- Pure refactor: no behavior change intended. Prove it by unchanged flag output
  in the existing scan-flags + useNutritionLookup.flags tests.

## Risks

- Over-unifying the three distinct detail messages into one would regress UX
  clarity (server-data-missing vs. connectivity-down are different situations).
  Parameterize the detail; share only the structural fields.

## Updates

### 2026-07-21

- Filed from the `/code-review` of PR #679 (finding #7). Third copy introduced by
  the total-outage fail-open fix in the same PR.
