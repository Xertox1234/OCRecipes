---
title: "validateNavigateParams checks safeParse but never reassigns the stripped result, so extra params survive into navigation"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, ai, navigation, client-state, data-integrity]
github_issue:
---

# `validateNavigateParams` validates but does not strip

## Summary

`shared/schemas/coach-blocks.ts`'s `validateNavigateParams` calls
`schema.safeParse(val.params)` and branches on `.success`, but never reassigns
`val.params` to the parsed `result.data`. Zod's stripping therefore never reaches the
object that is actually navigated with, so extra keys survive validation.

## Background

Surfaced during the review of PR #837 (`NutritionDetail` route-param discriminated
union). That PR made `RootStackParamList["NutritionDetail"]` a 3-arm discriminated union
so `{ itemId, barcode }` is a compile error. `CoachChat.tsx` (~line 365) has a
**pre-existing** `params as RootStackParamList["NutritionDetail"]` cast, and an `as` cast
bypasses the union entirely — so the runtime backstop is the only thing left, and the
backstop does not strip.

Concretely: a Coach action-card payload of `{ itemId, barcode }` for
`screen: "NutritionDetail"` passes validation (barcode alone satisfies the schema) with
`itemId` still attached, and reaches `useNutritionLookup` with both selectors set — the
exact illegal state PR #837 made unrepresentable at compile time.

This also corrected a **wrong claim in the prior docblock**, which stated that `CoachChat`
"is Zod-narrowed to `{ barcode }`, which strips an `itemId`". It does not. PR #837's
docblock in `client/hooks/useNutritionLookup.ts` now states the real behaviour; this todo
is the fix that docblock defers.

Severity is low-to-medium: it requires the LLM to emit that specific malformed payload,
and it is not currently observed in production. It is filed rather than fixed because it
was outside PR #837's Scope Contract.

Related: `docs/solutions/conventions/a-stated-invariant-is-not-an-enforced-one-2026-08-06.md`.

## Acceptance Criteria

- [ ] `validateNavigateParams` reassigns `val.params` to the parsed/stripped `result.data`
      on success (or otherwise guarantees the navigated object carries only schema keys)
- [ ] A test proves a `{ itemId, barcode }` payload for `screen: "NutritionDetail"` has
      `itemId` removed after validation — verified RED first against the current code
- [ ] The `as RootStackParamList["NutritionDetail"]` cast in `CoachChat.tsx` is either
      removed in favour of the now-trustworthy narrowed type, or its remaining necessity
      is documented at the call site
- [ ] The deferring note in `client/hooks/useNutritionLookup.ts`'s docblock is updated to
      record that the gap is closed
- [ ] Closes with zero follow-ups

## Implementation Notes

- The single-line shape of the bug is `schema.safeParse(val.params)` used only for its
  `.success` boolean. Zod returns the stripped object on `result.data`; nothing reads it.
- Check every branch of `validateNavigateParams`, not just the `NutritionDetail` arm —
  the same validate-but-discard shape may repeat per screen.
- Prefer fixing the stripping over deleting the `as` cast alone; the cast is a symptom,
  the non-stripping validator is the cause.
- Depends on PR #837 having merged (it introduces the discriminated union this relies on).

## Scope Contract

- **Mechanisms to use:** the existing Zod schema + `validateNavigateParams` function —
  no new validation layer, no new schema file, no navigation refactor
- **Files in scope:** `shared/schemas/coach-blocks.ts` and its co-located `__tests__/`,
  `client/components/coach/CoachChat.tsx` (cast removal only),
  `client/hooks/useNutritionLookup.ts` (docblock note only)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #837 (`todo/P2-2026-08-15-nutritiondetail-route-params-permit-illegal-mode-combinations`)
  must merge first — it introduces the discriminated union and the docblock this updates.

## Risks

- Stripping changes what downstream consumers receive. Confirm no screen relies on an
  extra key currently surviving validation before tightening.
- Low reachability means a test is the only practical evidence; a manual repro would
  require coaxing the LLM into emitting the malformed payload.

## Updates

### 2026-08-16

- Filed by the `/todo` orchestrator after PR #837's executor reported filing this todo but
  no such file was created on any branch (verified: `git log --all --diff-filter=A` and a
  per-branch `git ls-tree` scan both returned nothing). The finding itself was not lost —
  it is documented in PR #837's docblock and PR body — but nothing was scheduling the fix.
