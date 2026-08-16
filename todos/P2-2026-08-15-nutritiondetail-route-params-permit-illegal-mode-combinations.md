---
title: "NutritionDetail's route params declare three mutually-exclusive modes as independent optionals, so an illegal combination type-checks"
status: backlog
priority: medium
created: 2026-08-15
updated: 2026-08-15
assignee:
labels: [deferred, react-native, navigation, typescript, client-state]
github_issue:
---

# NutritionDetail's three entry modes are not mutually exclusive in the type

## Summary

`RootStackParamList["NutritionDetail"]` declares `barcode?`, `imageUri?` and `itemId?` as
three independent optional fields, but `useNutritionLookup` treats them as three
**mutually exclusive** entry modes and dispatches on them in a fixed priority order.
Nothing stops a caller passing two at once, `tsc` cannot object, and the hook's behaviour
in that case contradicts an invariant that two shipped decisions rest on.

## Background

Found by a `code-reviewer` pass over `be3ba334..ca4b1894` (PRs #819/#821/#823) on
2026-08-15, and deliberately left out of scope there — those PRs were comment-accuracy
follow-ups and this is a typed-surface change with real blast radius.

### The combination that misbehaves

`itemId` + `barcode` together. The dispatching effect in
`client/hooks/useNutritionLookup.ts` reads:

```ts
if (existingItem) { … return; }        // saved item loaded
if (existingItemFailed) { … return; }  // saved item failed
if (barcode) { void fetchBarcodeData(barcode); }
else if (imageUri) { … }
else if (!itemId) { … }
```

On the renders **before the `existingItem` query settles**, the first two guards are both
false, so it falls through and runs `fetchBarcodeData(barcode)` — which calls
`setServingSizeGrams` and `setValidatedData` while `itemId` is set. That directly
contradicts the docblock on `servingSizeGrams`' initialiser: _"Stays null for the whole
itemId/saved-item path, deliberately."_

Two shipped decisions lean on that invariant:

- **PR #819's** safety argument for `effectivePer100g`'s null guard — the case analysis
  assumes the saved-item path never has `validatedData`.
- **The archived won't-do** in
  `todos/archive/P3-2026-08-15-should-saved-item-path-populate-servingsizegrams.md`, whose
  whole basis is that nothing populates a gram basis on that path.

Neither is wrong today. Both are unenforced.

### Not live — and the bound is worth keeping

Enumerated 2026-08-15 against `ca4b1894`: **no caller passes `itemId` at all.**

| Producer                                                               | Params                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/screens/scan-screen-utils.ts:385` `buildNutritionDetailParams` | `barcode` + optional `ocrText`/`nutritionImageUri`/`frontImageUri`                                                                                                |
| `client/components/coach/CoachChat.tsx:362-365`                        | Zod-narrowed to `{ barcode }` by `screenParamSchemas.NutritionDetail` (`shared/schemas/coach-blocks.ts`) — `z.object` strips an `itemId` an LLM action might emit |
| history taps (`client/hooks/useHistoryData.ts:186`)                    | navigate to the separate **`ItemDetail`** screen, which does not use this hook                                                                                    |

So the saved-item branch of `useNutritionLookup` is wired and typed but currently has **no
production producer**. That makes this a hardening task, not a bug fix — file it as such,
and do not let an implementer describe it as fixing a live defect.

### This is NOT the sibling param todo

`todos/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md` is a different
mechanism in the same family and the two fixes do not overlap:

|        | That one                                                                                                                                     | This one                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Defect | Two navigators declare the same screen's param under different names (`date` vs `plannedDate`); a `recipeId` is laundered in by an `as` cast | One declaration, correct everywhere, that **permits a combination the screen cannot handle** |
| Fix    | Reconcile the names, remove the cast                                                                                                         | Make the modes mutually exclusive in the type                                                |

Nor is it the defect `scripts/check-route-params.js` / the #816 ESLint rule catch — those
target a screen restating its params instead of indexing the canonical ParamList. Here the
ParamList is canonical and correctly indexed; it is simply too permissive.

## Acceptance Criteria

- [ ] `RootStackParamList["NutritionDetail"]` becomes a discriminated union whose three
      arms are the three entry modes, with the absent selectors typed `?: never` so the
      screen can still destructure all of them in one statement
- [ ] **The scan-capture companions stay on the barcode arm.** `ocrText`,
      `nutritionImageUri` and `frontImageUri` are NOT mode selectors — they ride with
      `barcode` (see `buildNutritionDetailParams`). Putting them outside the union, or
      omitting them from the barcode arm, breaks the label-vs-DB override flow
- [ ] `buildNutritionDetailParams` still type-checks with its incremental-build shape
      (`const params: NutritionDetailParams = { barcode }` then conditional field
      assignment) — narrowing to the barcode arm must permit those assignments
- [ ] Passing `{ itemId, barcode }` together is a **compile error**, proven by a
      type-level test. Per
      `docs/solutions/conventions/vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md`,
      Vitest's transform strips types without checking them — the evidence must be
      `tsc --noEmit`, not a passing test file
- [ ] `client/screens/NutritionDetailScreen.tsx`, `scan-screen-utils.ts`, `CoachChat.tsx`
      and `shared/schemas/coach-blocks.ts` all still compile with no new `as` casts — a
      cast to satisfy the union defeats the entire point
- [ ] `useNutritionLookup`'s dispatching effect and its `servingSizeGrams` docblock are
      updated to state that exclusivity is now compiler-enforced, replacing the
      "convention, not enforced" caveat added in PR #828

## Implementation Notes

Current shape (`client/navigation/RootStackNavigator.tsx:90-101`) — six optionals, of
which only the first three are modes:

```ts
NutritionDetail: {
  barcode?: string;
  imageUri?: string;
  itemId?: number;
  ocrText?: string | null;      // rides with barcode
  nutritionImageUri?: string;   // rides with barcode
  frontImageUri?: string;       // rides with barcode
};
```

Sketch — confirm against the real producers before committing to it:

```ts
NutritionDetail:
  | { barcode: string; imageUri?: never; itemId?: never;
      ocrText?: string | null; nutritionImageUri?: string; frontImageUri?: string }
  | { itemId: number; barcode?: never; imageUri?: never }
  | { imageUri: string; barcode?: never; itemId?: never };
```

- **Verify the `imageUri` arm's companions rather than assuming.** The hook's `imageUri`
  branch only sets a "Manual Entry" placeholder, so it likely carries none — but check
  `PhotoIntent`/`PhotoAnalysis` hand-offs before excluding them.
- `screenParamSchemas.NutritionDetail` in `shared/schemas/coach-blocks.ts` is
  `z.object({ barcode: z.string() })`. It already produces only the barcode arm, so it
  should need no change — confirm, don't assume, since it feeds an `as` cast at
  `CoachChat.tsx:365` that a union may newly reject.
- Deep links go through `client/navigation/linking.ts` (`ocrecipes://nutrition/:barcode`),
  which produces `barcode` only. A union arm typed `barcode: string` (required) is
  compatible; check the linking config's own param typing.

## Scope Contract

- **Mechanisms to use:** a discriminated union on the existing ParamList entry — no new
  runtime validation, no new navigator, no schema change
- **Files in scope:** `client/navigation/RootStackNavigator.tsx`,
  `client/screens/NutritionDetailScreen.tsx`, `client/screens/scan-screen-utils.ts`,
  `client/hooks/useNutritionLookup.ts`, `client/components/coach/CoachChat.tsx`, and the
  co-located tests for those
- Explicitly OUT of scope: `RecipeBrowserModal`'s params (its own todo), and any change to
  the hook's runtime dispatch ORDER — this task makes the illegal state unrepresentable,
  it does not re-architect the effect
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. PR #828 documents the unenforced invariant inline; this replaces that
  caveat with enforcement.

## Risks

- **Blast radius is the whole point and the whole risk.** Six call sites plus deep linking
  and a Zod-validated coach action. If the union forces an `as` cast anywhere, the change
  has failed — a cast re-permits exactly the combination being outlawed.
- `?: never` arms interact awkwardly with object spreads. If a producer builds params by
  spreading a partial, the union may reject it for reasons unrelated to the invariant;
  prefer fixing the producer over widening the union.
- Zero user-visible change. Judge it on `tsc` evidence, not on a simulator pass.

## Updates

### 2026-08-15

- Filed at the user's request from a `code-reviewer` finding on the
  `be3ba334..ca4b1894` review pass. Producer enumeration and the "no current `itemId`
  producer" bound verified the same day against `ca4b1894`.
