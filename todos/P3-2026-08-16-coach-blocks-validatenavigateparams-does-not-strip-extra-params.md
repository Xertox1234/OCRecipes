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

**AC1 and AC2 do NOT depend on PR #837** — they are implementable against current `main`
today. Only AC3 and AC4 need #837 (see Dependencies). Do not let the live data-integrity
bug sit open waiting on #837 if it stalls.

- [ ] `validateNavigateParams` reassigns `val.params` to the parsed/stripped `result.data`
      on success — **but first widen the two schemas below, or stripping will silently
      break working behaviour.** Verified 2026-08-16 by probing the live module: two other
      screens currently rely on extra keys surviving validation, and a naive "strip
      everything not in the schema" fix would delete them: - `screenParamSchemas.FeaturedRecipeDetail = z.object({ recipeId: z.number() })`
      (`shared/schemas/coach-blocks.ts:46`) — `recipeType` and `type` survive today and
      are real fields on `RootStackParamList["FeaturedRecipeDetail"]`
      (`client/navigation/RootStackNavigator.tsx:114-120`). - `screenParamSchemas.RecipeChat = z.object({ conversationId: z.number() })`
      (`coach-blocks.ts:47`) — `initialMessage`, `remixSourceRecipeId`, and
      `remixSourceRecipeTitle` survive today and are real fields on
      `RootStackParamList["RecipeChat"]` (`RootStackNavigator.tsx:155-161`).
      `initialMessage` is plausibly how the coach pre-fills a RecipeChat message.
      For each: either widen the schema to include the tolerated field, or confirm and
      document that the LLM never emits it before tightening.
- [ ] A test proves a `{ itemId, barcode }` payload for `screen: "NutritionDetail"` has
      `itemId` removed after validation — verified RED first against the current code.
      Exercise **both** call sites, not just `action_card`: the `suggestion_list` path
      (`suggestionListSchema`, via `navigateActionSchema.superRefine`) reproduces the
      identical leak and has zero existing coverage for it in
      `shared/schemas/__tests__/coach-blocks.test.ts`.
- [ ] The `as RootStackParamList["NutritionDetail"]` cast in `CoachChat.tsx` is either
      removed in favour of the now-trustworthy narrowed type, or its remaining necessity
      is documented at the call site
- [ ] The deferring note in `client/hooks/useNutritionLookup.ts`'s docblock is updated to
      record that the gap is closed
- [ ] Closes with zero follow-ups

## Implementation Notes

- The single-line shape of the bug is `schema.safeParse(val.params)` used only for its
  `.success` boolean. Zod returns the stripped object on `result.data`; nothing reads it.
- Shape of the work, verified rather than guessed (2026-08-16): `validateNavigateParams`
  is **one function with two call sites** covering **three screens** — one fix location.
  The call sites are `blockActionSchema`'s inline `.superRefine` (`coach-blocks.ts:83-87`)
  and the standalone `navigateActionSchema.superRefine(validateNavigateParams)` backing
  `suggestionListSchema` (`coach-blocks.ts:126-128`). There are no per-screen branches to
  hunt for.
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

- **AC3 and AC4 only:** PR #837
  (`todo/P2-2026-08-15-nutritiondetail-route-params-permit-illegal-mode-combinations`)
  must merge first — it introduces the discriminated union that makes the cast removable
  (AC3), and the `useNutritionLookup.ts` docblock text AC4 updates exists only on that
  branch, not on `main`.
- **AC1 and AC2 have no dependency.** Verified: #837's diff touches
  `client/hooks/useNutritionLookup.ts` and `client/navigation/RootStackNavigator.tsx` and
  never `shared/schemas/coach-blocks.ts` or `CoachChat.tsx`. The reassignment fix and its
  regression test can land against `main` today. AC5 (zero follow-ups) means the todo
  cannot _close_ until #837 lands, but the bug fix need not wait.

## Risks

- Stripping changes what downstream consumers receive — and two concrete instances already
  exist, enumerated under AC1: `FeaturedRecipeDetail` (`recipeType`, `type`) and
  `RecipeChat` (`initialMessage`, `remixSourceRecipeId`, `remixSourceRecipeTitle`). These
  are not hypothetical; they survive validation on `main` today. Widen those schemas or
  document the fields as unused before tightening, or the fix silently breaks them.
- Low reachability means a test is the only practical evidence; a manual repro would
  require coaxing the LLM into emitting the malformed payload.

## Updates

### 2026-08-16

- Filed by the `/todo` orchestrator after PR #837's executor reported filing this todo but
  no such file was created on any branch (verified: `git log --all --diff-filter=A` and a
  per-branch `git ls-tree` scan both returned nothing). The finding itself was not lost —
  it is documented in PR #837's docblock and PR body — but nothing was scheduling the fix.
