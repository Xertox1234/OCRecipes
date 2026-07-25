---
title: "DB-sourced ids flowing into a keyed-map deref need a skip-unknown guard at the lookup point"
track: knowledge
category: conventions
tags: [client, allergens, jsonb, error-boundary, fail-safe, zod, render-crash]
module: client
applies_to: [client/components/recipe-allergen-label-utils.ts, client/components/**/*.tsx]
created: '2026-07-24'
---

# DB-sourced ids flowing into a keyed-map deref need a skip-unknown guard at the lookup point

## Rule

When a render-path helper maps persisted ids to display data via a keyed
constant map (`MAP[id].label`), and any consumer feeds it ids from the
database through an **un-Zod-guarded** wire path (`res.json()` straight into
props), the helper must **skip ids missing from the map**, not dereference
them. One stale row must degrade to "this entry isn't rendered", never to a
render-time `TypeError` that unmounts the entire list to the root
ErrorBoundary.

## The incident

PR #709 plumbed the persisted `allergens` jsonb column into four new surfaces
(Favourites, CookbookDetail, Carousel, MealPlanHome). `toRecipeAllergenLabels`
did `ALLERGEN_INGREDIENT_MAP[id].label` unconditionally. The pre-existing
consumer (`RecipeBrowserScreen`) was safe only *incidentally* — its
`useRecipeSearch` hook happened to `safeParse` with a strict
`z.enum` id schema before the deref could see bad data. The four new
consumers used bare `res.json()` hooks, so the first surface to meet a stale
id (a future allergen-id rename with old rows, an unvalidated backfill or
import) would crash the whole screen — in an allergen-safety feature whose
display contract is "absence renders nothing".

## Why "skip" is the right failure direction here

The label is **precautionary** (fail-dangerous display: `null`/`[]`/unknown
all render nothing — see
`docs/solutions/conventions/precautionary-safety-display-renders-nothing-never-safe-2026-07-24.md`).
Skipping an unrecognized id renders *less*, which the contract already defines
as "makes no safety claim". Crashing renders *nothing of the entire screen*,
and a hand-rolled fallback label would invent data. For a display whose empty
state is already safe, skip-unknown is strictly better than throw.

## How to apply

1. Guard at the **lookup point** (the shared util), not per consumer — new
   consumers inherit the guard automatically.
2. `filter(({ id }) => id in MAP)` before the `map` — and add the two tests:
   a known+unknown mix keeps the known entry; an all-unknown input returns
   the same empty result as `null` (renders nothing, never a "safe" signal).
3. A Zod wire-guard on each consumer remains the stronger end-state, but do
   not let its absence be load-bearing for crash-safety: the deref guard is
   one line and covers every present and future caller.
