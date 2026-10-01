---
title: A nested navigator that declares an existing route NAME silently re-targets every navigate() to it — no compile error, no diff on the call site
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-native, navigation, react-navigation, route-names, shadowing, dead-code]
symptoms: ['A screen branch is fully implemented, typed and covered by tests, but nothing in production ever opens it', 'A grep for `navigate("Screen"` finds producers that look correct, yet the screen they appear to target never renders', 'Two screens exist for the same user-facing thing and nobody can say which one is live', 'Comments and decision records describe a path as live user-facing behaviour when no user can reach it', 'A navigator registers a `name=` that also exists in an ancestor navigator', 'The commit that broke reachability shows no change to any `navigate()` call']
applies_to: [client/navigation/**/*.tsx, client/navigation/**/*.ts, client/screens/**/*.tsx]
created: '2026-09-17'
---

# A nested navigator that declares an existing route NAME silently re-targets every navigate() to it

## Problem

React Navigation resolves `navigate("X")` to the **nearest** navigator that
declares `X`, walking outward only if none does. So adding a route named `X` to
a **child** navigator, when an ancestor already declares `X`, re-points every
existing `navigate("X", …)` call in that subtree at the new screen.

Nothing marks the change:

- the call sites are not edited, so the commit's diff shows no `navigate()` line;
- both route names are string literals that still type-check, because each
  navigator's own `ParamList` is internally consistent;
- there is no runtime warning — this is the documented resolution order, not an
  error condition.

In OCRecipes this left a fully-built screen branch stranded for ~8 months.
`d8982797` (2026-01-28) registered `ItemDetailScreen` inside
`HistoryStackNavigator` under the name `NutritionDetail`, which `RootStack`
already declared. `HistoryScreen`'s unchanged
`navigate("NutritionDetail", { itemId })` began resolving to the History
stack's new local route. `649af17b` renamed that route to `ItemDetail` the
following day and repointed the call, making the split permanent.

`NutritionDetailScreen`'s `itemId` branch — a `/api/scanned-items/:id` query, a
distinct render path, a dedicated `selectBandSource` arm, and its own tests —
survived with no producer. Two shipped decisions (#819's `effectivePer100g`
guard, an archived won't-do) went on reasoning about the saved-item path as
live user-facing behaviour.

## Symptoms

- A branch is wired, typed and tested, and no production code reaches it.
- Enumerating producers by grepping the screen name finds callers that look
  right — the string never changed, so the enumeration cannot see the re-target.
- Two independent implementations of one user-facing thing, with no record of
  which superseded which.

## Root Cause

Route names are resolved dynamically by proximity in the navigator tree, but
they are authored as **string literals in per-navigator `ParamList` types**.
TypeScript checks each navigator's params against its own list and never
compares names **across** navigators, so a collision is invisible to the
compiler. The name is a runtime routing key wearing a compile-time costume.

The grep blind spot follows from the same fact: the defect lives in the
navigator's registration, while the symptom lives at a call site that was never
touched. Searching by the symptom's spelling returns a clean, reassuring answer.

## Solution

Detect collisions structurally rather than by reading call sites. Intersect
every nested navigator's declared route names with the root's — a non-empty
intersection is the defect:

```bash
# NESTED navigators' registered names, against every RootStackParamList key.
#
# `xargs`, not an unquoted `$VAR`: zsh word-splits `$(cmd)` but NOT a parameter,
# so `NESTED=$(ls ...); grep ... $NESTED` passes the newline-joined list to grep
# as ONE non-existent filename. grep then matches nothing, `comm` prints
# nothing, and the run reads as "no collisions" — the same false clean this
# check exists to prevent. Measured 2026-09-17 under zsh: 0 left-side matches
# via the parameter form, 34 via xargs. That 34 is the RAW match count, BEFORE
# `sort -u`; it collapses to the 33 unique names reported below because
# `FavouriteRecipes` is registered in two navigators (ProfileStackNavigator and
# MealPlanStackNavigator). Two SIBLING navigators cannot shadow each other —
# only a nested route shadows a ROOT one — so the duplicate is not a defect.
# The two figures are the same pipeline measured at two different stages.
#
# Excluding RootStackNavigator.tsx is the other half: it matches a bare
# *Navigator.tsx glob, and its own registrations then intersect its own
# ParamList. Measured 2026-09-17 — the unexcluded form reported all 33 root
# routes as collisions.
ls client/navigation/*Navigator.tsx | grep -v RootStackNavigator.tsx \
  | xargs grep -hoE 'name="[A-Za-z]+"' \
  | sed -E 's/name="([A-Za-z]+)"/\1/' | sort -u > /tmp/nav-names.txt

sed -n '/export type RootStackParamList/,/^};/p' client/navigation/RootStackNavigator.tsx \
  | grep -oE '^  [A-Za-z]+:' | tr -d ' :' | sort -u > /tmp/root-keys.txt

# Print both counts BEFORE the verdict. A zero on either side makes `comm`
# silent, which is indistinguishable from a clean result.
echo "nested=$(wc -l < /tmp/nav-names.txt) root=$(wc -l < /tmp/root-keys.txt)"
comm -12 /tmp/nav-names.txt /tmp/root-keys.txt    # any output = a shadowed name
```

Verified 2026-09-17 against this repo, under both `bash` and `zsh`: `nested=33
root=33` (different sets that happen to be the same size), `comm` empty — no
collisions.

Control the measurement, not just the pipeline. Appending an injected name
downstream proves nothing, because the injection does not depend on the `grep`
having worked — that control passes even when the left side is empty. Assert the
LEFT-SIDE COUNT instead, then inject:

```bash
[ "$(wc -l < /tmp/nav-names.txt)" -gt 0 ] || { echo "PROBE BROKEN: left side empty"; exit 1; }
(cat /tmp/nav-names.txt; echo NutritionDetail) | sort -u \
  | comm -12 - /tmp/root-keys.txt    # must print exactly: NutritionDetail
```

Resolving the stranded branch is then an ordinary decision — wire a producer, or
delete it. Before deleting, re-verify the "no producer" claim across **every**
channel, not just literal call sites: dynamic targets (`navigate(someVar, …)`),
imperative `navigationRef.navigate`, deep-link path config, and any
`params as RootStackParamList[...]` cast that bypasses the union.

## Prevention

- **Route names are global in effect, even though they are declared locally.**
  Treat adding a `name=` that exists anywhere else in the tree as a rename of
  every call site beneath it, and say so in the commit message.
- **A negative reachability claim has to be traversed, not asserted.** "No
  producer navigates here" is a bounding claim; enumerate the channels and show
  each one's result. A regex sweep that returns zero needs a positive control —
  a synthetic input it *must* match — or an empty result is indistinguishable
  from a broken pattern.
- **Quote the command that produced the number, and re-run THAT command.** Two
  citations in this change shipped wrong because the figure came from a
  near-miss variant of the command beside it: an md5 taken from a `$(...)`
  capture through `printf '%s'` (command substitution strips the trailing
  newline, so the digest differs entirely from piping the same bytes straight to
  `md5`), and a detection pipeline verified with `$(cat file)` but committed with
  an unquoted `$VAR`. Extract the snippet from the file you are about to commit
  and run it — testing what you meant is not testing what you wrote.
- **When a deletion forces a test onto a new fixture path, assert the
  precondition that makes the fixture reach the state under test.** Moving two
  guard tests onto a different path here looked correct and was not: the added
  `expect(validatedData).toBeNull()` failed, revealing the new path set the very
  state the guard needed absent. Without that assertion both tests would have
  gone green while exercising nothing. The assertion that documents *why* the
  fixture reaches the state is what stops an adapted test passing for the wrong
  reason.

## Related Files

- `client/navigation/RootStackNavigator.tsx` — the root `ParamList`; its
  `NutritionDetail` entry records the removal and the two commits behind it.
- `client/navigation/ProfileStackNavigator.tsx` — registers `ItemDetail`, the
  route the saved-item flow actually uses.
- `client/hooks/useHistoryData.ts` — the producer, navigating to `ItemDetail`.
- `todos/archive/P2-2026-08-16-nutritiondetail-itemid-branch-has-no-producer.md`
  — the decision record, with the full reachability traversal.

## See Also

- [local-route-param-type-shadows-canonical-paramlist](local-route-param-type-shadows-canonical-paramlist-2026-07-30.md) — the TYPE-level sibling of this bug, on the same screen: a screen restating its own params shadows the canonical `ParamList`. Same word, different layer — that one loses fields, this one loses the whole destination.
- [../conventions/align-route-params-dual-navigator-screens](../conventions/align-route-params-dual-navigator-screens-2026-05-13.md) — keeping params aligned when one screen is mounted in two navigators; the legitimate case this bug is the accidental version of.
- [navigation-reset-silently-noops-across-stacked-modals](navigation-reset-silently-noops-across-stacked-modals-2026-07-30.md) — another navigation action that silently does nothing rather than erroring.
