---
title: "Duplicated flag-composition logic across two display surfaces desyncs when a refactor updates only one call site"
track: bug
category: logic-errors
tags: [scan, flags, composition, duplication, refactor-drift, accessibility]
module: client
applies_to: ["client/screens/ScanScreen.tsx", "client/screens/ScanScreenConfirmOverlay-utils.ts", "shared/types/scan-flags.ts"]
symptoms: ["Two UI surfaces that are supposed to show the same derived value diverge after an unrelated refactor", "A confirm/summary overlay shows fewer or different badges/flags than the equivalent lock-screen or chip surface for the identical underlying data", "The bug has no failing data path — the raw flags array is identical at both call sites; only the DERIVED single-value selection differs"]
created: 2026-07-24
severity: medium
---

# Duplicated flag-composition logic across two display surfaces desyncs when a refactor updates only one call site

## Problem

Smart Scan's scan-lock chip (`ProductChip.tsx`, fed by `ScanScreen.tsx`'s
`fetchProductInfo`) and the `returnAfterLog` confirm-card overlay
(`ScanScreenConfirmOverlay-utils.ts`'s `buildLoadedConfirmCard`) both need to
pick ONE "top flag" to display from the same server `flags[]` array. Both call
sites independently inlined the same selection expression:

```ts
// duplicated in TWO files
const topFlag =
  pickTopSafetyFlag(flags) ??
  pickTopFlag(flags.filter((f) => f.tier !== "safety" && f.severity !== "info"));
```

A later refactor (PR #708) updated the chip's call site — renaming fields and
adjusting the composition — but the confirm-card's separate inline copy was
never touched. The confirm-card silently regressed to `pickTopSafetyFlag`
alone, permanently losing the "fall back to a warn-level nutrition flag"
behavior the chip still had. Nothing crashed and no test caught it: each
file's own tests passed because each file's own (now-diverged) logic was
internally consistent.

## Symptoms

- One display surface shows a flag/badge the other doesn't, for the exact
  same underlying data.
- Git history shows a refactor PR touching only one of the two files that
  logically needed the same change.
- The divergence is easy to miss because it's a "shows LESS than before" bug
  on one surface, not a crash or an obviously-wrong value — it reads as the
  surface being conservative/safe, not broken.

## Root Cause

The composition logic (how to pick a single display flag from an array) was
expressed as an inline expression at each call site instead of a named,
shared function. There was nothing forcing the two call sites to stay in
sync — a future editor touching one has no signal that a sibling copy exists
elsewhere, and neither TypeScript nor the test suite can catch "these two
independently-written expressions used to be equivalent and no longer are."

## Solution

Extract the composition into ONE named, exported function
(`pickTopDisplayFlag` in `shared/types/scan-flags.ts`) with a doc comment
that explicitly calls out that every display surface consuming a "top flag"
must call it, not re-derive it inline:

```ts
/**
 * Top single-badge flag for compact display surfaces (the scan-lock chip,
 * the returnAfterLog confirm-card overlay): ... Both display surfaces must
 * call this shared helper rather than re-deriving the composition inline —
 * a prior refactor updated one call site's inline logic without the other,
 * producing a parity gap between the two surfaces.
 */
export function pickTopDisplayFlag(flags: ScanFlag[]): ScanFlag | undefined {
  return (
    pickTopSafetyFlag(flags) ??
    pickTopFlag(flags.filter((f) => f.tier !== "safety" && f.severity !== "info"))
  );
}
```

Both `ScanScreen.tsx` and `ScanScreenConfirmOverlay-utils.ts` now import and
call this one function. A parity test pair (in
`shared/types/__tests__/scan-flags.test.ts` and
`client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts`)
locks the same three scenarios (safety-wins, nutrition-fallback,
info-never-surfaces) for both consumers.

## Prevention

**When two or more UI surfaces need to derive the same single value from a
shared data array (a "pick the top N" / "pick the representative one"
composition), extract it into ONE named function the moment a second call
site appears — never let the same non-trivial derivation live as
independently-typed inline expressions in two files.** A quick heuristic
during review: if a diff changes how a derived display value is computed at
one call site, grep for the same raw inputs (`flags`, `pickTopSafetyFlag`,
etc.) elsewhere in the codebase before approving — a sibling call site that
should have moved in lockstep is the tell. The same pattern applies beyond
flags: any "pick the badge/summary/headline value to show" logic that's
consumed by more than one screen or component is a duplication risk the
moment it's copy-pasted rather than imported.

## Related Files

- `shared/types/scan-flags.ts` — `pickTopDisplayFlag`, the shared composition
- `client/screens/ScanScreen.tsx` — `fetchProductInfo`'s `topFlag` (chip)
- `client/screens/ScanScreenConfirmOverlay-utils.ts` — `buildLoadedConfirmCard`'s `safetyFlag` field (confirm-card, despite the field name — see its doc comment)
- `shared/types/__tests__/scan-flags.test.ts` — `pickTopDisplayFlag` unit tests
- `client/screens/__tests__/ScanScreenConfirmOverlay-utils.flags.test.ts` — confirm-card parity tests

## See Also

- [broadened matcher needs new-input regression tests](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the sibling lesson for detection logic: a change in one place needs a regression test exercising the NEW behavior, not just the old
