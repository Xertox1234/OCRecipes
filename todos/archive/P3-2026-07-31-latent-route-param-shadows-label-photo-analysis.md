---
title: "LabelAnalysisScreen and PhotoAnalysisScreen still restate their route params — latent shadows of RootStackParamList"
status: done
priority: low
created: 2026-07-31
updated: 2026-08-15
assignee:
labels: [deferred, typescript, react-native, navigation]
github_issue:
---

# Two screens still restate their route params

## Summary

`LabelAnalysisScreen.tsx:64` and `PhotoAnalysisScreen.tsx:47` each declare their own
`type RouteParams` instead of indexing `RootStackParamList`. Both currently match the
navigator field-for-field, so **there is no data loss today** — they are latent.

## Background

Surfaced by the `/code-review` pass on PR #744, which codified this exact defect after
`NutritionDetailScreen` lost two user-captured photo URIs to it (PR #742). The new
`code-reviewer` §1 rule bans the pattern; these two are the remaining instances.

They are latent in precisely the state the solution doc describes: _"it starts out
accurate — it only becomes a lie when someone extends the navigator."_ A param added to
`RootStackParamList["LabelAnalysis"]` produces no error at any layer and silently never
arrives at the screen. Strict mode cannot help: you cannot fail to read a field your own
type says does not exist.

Both were verified against the navigator during the review — `LabelAnalysis`
(`RootStackNavigator.tsx:82-89`) and `PhotoAnalysis` (`:108-111`) are in sync **as of
2026-07-31**. Re-verify before assuming that still holds; if they have drifted by the
time this is picked up, the drift itself is the bug and this stops being low-severity.

## Acceptance Criteria

- [x] `LabelAnalysisScreen` uses `RouteProp<RootStackParamList, "LabelAnalysis">`; its
      local `RouteParams` is deleted.
- [x] `PhotoAnalysisScreen` uses `RouteProp<RootStackParamList, "PhotoAnalysis">`; its
      local `RouteParams` is deleted.
- [x] Any param the swap reveals as previously-ignored is either read or explicitly
      documented as deliberately unused — surfacing them is the point, not a side effect.
      **No-op:** both local types matched their navigator entry field-for-field and
      every param was already consumed, so the swap revealed nothing.
- [x] No behavior change: `route.params` destructuring and every downstream consumer
      behave identically. Existing tests for both screens still pass unchanged.
      Every destructuring line is byte-identical in the diff.
- [x] A `git grep "type RouteParams" client/screens/` returns nothing afterwards.

## Implementation Notes

- The canonical fix shape is in
  `docs/solutions/logic-errors/local-route-param-type-shadows-canonical-paramlist-2026-07-30.md`,
  and `client/screens/NutritionDetailScreen.tsx:67` is the worked example.
- `route.params || {}` keeps type-checking after the swap — an all-optional member type
  makes `{}` assignable, so the defensive fallback costs nothing.
- Watch for three-valued fields (`string | null | undefined`). Deriving preserves them;
  do not let a swap collapse `null` into `undefined`.
- `LabelAnalysis` declares a required `imageUri: string`, unlike `NutritionDetail`'s
  all-optional shape — check whether `|| {}` is still the right guard there, or whether
  the screen should assume the param.

## Scope Contract

- **Mechanisms to use:** the existing `RootStackParamList` type and `RouteProp` — nothing new.
- **Files in scope:** `client/screens/LabelAnalysisScreen.tsx`,
  `client/screens/PhotoAnalysisScreen.tsx`, and their `__tests__/` if assertions need updating.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #742 already landed the pattern and PR #744 the codified rule.

## Risks

- Swapping the type may reveal other params these screens silently ignore. That is the
  point, but it can widen the diff beyond a pure type change — if a revealed param turns
  out to matter, that is a separate finding worth surfacing rather than quietly wiring up.

## Updates

### 2026-07-31

- Initial creation, deferred out of the PR #744 review.

### 2026-08-15 — done

**No drift.** Both local types still matched their navigator entry field-for-field, and
every param was consumed. Still latent, still low-severity; the swap revealed nothing.

**The todo's premise was wrong: there were three instances, not two.**
`client/screens/ItemDetailScreen.tsx:21` shadowed `ProfileStackParamList` with
`RouteProp<{ ItemDetail: { itemId: number } }, "ItemDetail">`. Both this todo's
`git grep "type RouteParams"` and my own `grep "RouteProp<{"` missed it, for two
separate reasons: it does not use the name `RouteParams`, and Prettier had wrapped it
across four lines so no single-line literal matched. It was in sync with its navigator,
so it too was latent — but it is the clearest possible evidence that a name-based or
single-line grep cannot bound this defect class.

Scope was widened once, deliberately (user-approved): the fix ships with
`scripts/check-route-params.js`, wired into lint-staged on `client/**/*.{ts,tsx}`. The
rule is **structural, not nominal** — it rejects an inline object literal as `RouteProp`'s
ParamList argument, tolerating whitespace and newlines between `RouteProp<` and `{`, and
deliberately permits a _derived_ `type RouteParams = ParamList["Foo"]`, which is the form
we want people to write. A nominal ban would have rejected the good form and still missed
`ItemDetailScreen`. Whole-tree sweep: 697 files, 0 violations.

Deliberately NOT fixed, surfaced instead: `PhotoAnalysisScreenNavigationProp` is declared
three times — exported at `client/types/navigation.ts:108`, re-declared locally in
`PhotoAnalysisScreen.tsx` and `usePhotoAnalysis.ts`. Same shadow class, different axis
(navigation prop, not route params). Separate change: it reaches a third file and is
asymmetric, since `LabelAnalysisScreen` has no counterpart export to reuse.
