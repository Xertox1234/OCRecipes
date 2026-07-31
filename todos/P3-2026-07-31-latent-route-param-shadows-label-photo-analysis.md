---
title: "LabelAnalysisScreen and PhotoAnalysisScreen still restate their route params — latent shadows of RootStackParamList"
status: backlog
priority: low
created: 2026-07-31
updated: 2026-07-31
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

- [ ] `LabelAnalysisScreen` uses `RouteProp<RootStackParamList, "LabelAnalysis">`; its
      local `RouteParams` is deleted.
- [ ] `PhotoAnalysisScreen` uses `RouteProp<RootStackParamList, "PhotoAnalysis">`; its
      local `RouteParams` is deleted.
- [ ] Any param the swap reveals as previously-ignored is either read or explicitly
      documented as deliberately unused — surfacing them is the point, not a side effect.
- [ ] No behavior change: `route.params` destructuring and every downstream consumer
      behave identically. Existing tests for both screens still pass unchanged.
- [ ] A `git grep "type RouteParams" client/screens/` returns nothing afterwards.

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
