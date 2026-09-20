---
title: "Reanimated 4 deprecates runOnUI and runOnJS in favour of react-native-worklets — 11 non-test files still reference them"
status: backlog
priority: low
created: 2026-09-20
updated: 2026-09-20
assignee:
labels: [deferred, mobile]
github_issue:
---

# Reanimated 4's deprecated worklet-threading APIs are still in use

## Summary

`react-native-reanimated@~4.3.1` marks both `runOnUI` and `runOnJS` `@deprecated`, redirecting to
`scheduleOnUI` and `scheduleOnRN` from the separate `react-native-worklets` package. Both still work
and `npm run check:types` reports **0 errors** — the deprecation is a JSDoc tag, not a type error —
so this is maintenance ahead of removal, not a defect.

## Background

Surfaced as editor diagnostics (TS6385) during an unrelated `/todo` run on 2026-09-20. Not a
regression from that run: `client/screens/HomeScreen.tsx` was last touched by `e79d0427` (#959), and
PRs #997/#998 added only test files plus `Card.tsx`/`SettingsScreen.tsx`.

**Measured inventory on `main`** (`client/`, `--include='*.ts' --include='*.tsx'`, `__tests__`
excluded). Quote the globs — the Bash tool's shell is zsh, which dies with `no matches found` on a
bare `*.tsx`:

`runOnUI` — 1 real call site:

| file                                            | line | kind                                  |
| ----------------------------------------------- | ---- | ------------------------------------- |
| `client/screens/HomeScreen.tsx`                 | 24   | import                                |
| `client/screens/HomeScreen.tsx`                 | 261  | the only call, inside `glideRowToTop` |
| `client/components/home/inline-drawer-utils.ts` | 6    | doc comment only, no call             |

`runOnJS` — **23 occurrences across 9 files**:

| file                                                 | occurrences |
| ---------------------------------------------------- | ----------- |
| `client/camera/hooks/useCameraFocusAndZoom.ts`       | 7           |
| `client/components/Toast.tsx`                        | 3           |
| `client/screens/meal-plan/MealPlanHomeScreen.tsx`    | 3           |
| `client/camera/components/ProductChip.tsx`           | 2           |
| `client/camera/components/ScanSonarRing.tsx`         | 2           |
| `client/components/SwipeableRow.tsx`                 | 2           |
| `client/hooks/useScrollLinkedHeader.ts`              | 2           |
| `client/camera/hooks/useCameraFocusAndZoom-utils.ts` | 1           |
| `client/hooks/useSheetBackHandler.ts`                | 1           |

Eleven distinct non-test files (2 + 9, no overlap), 26 references total (3 + 23). The size is why this is filed rather than fixed
inline: it is low **severity** (works today) but not low **effort**, and four of the files are camera
code, which carries its own gotchas.

Replacement targets, verbatim from
`node_modules/react-native-reanimated/lib/typescript/workletFunctions.d.ts`:

- `runOnUI` → `scheduleOnUI` from `react-native-worklets` (deprecation block at lines 39-48)
- `runOnJS` → `scheduleOnRN` from `react-native-worklets` (deprecation block at lines 29-38)

> ⚠️ Read that file by DECLARATION, not by proximity. Each `@deprecated` block sits **above** the
> symbol it documents, and the blocks are easy to misattribute by one: the block at line 20 saying
> "use `runOnUISync`" documents `executeOnUIRuntimeSync` (line 28) — **not** `runOnUI`, which is
> declared at line 48 under its own `scheduleOnUI` block. An earlier revision of this todo made
> exactly that off-by-one and named the wrong target throughout; review caught it.

- Migration guide: <https://docs.swmansion.com/react-native-reanimated/docs/guides/migration-from-3.x/>

## Acceptance Criteria

- [ ] `grep -rn "runOnUI\|runOnJS" client/ --include='*.ts' --include='*.tsx'` returns no non-test
      hits, and the now-unused imports are removed from every file in the table above.
- [ ] `client/components/home/inline-drawer-utils.ts:6`'s comment no longer names `runOnUI` — it
      names whatever the call site actually uses afterwards. A migration that leaves this comment
      behind is a stale citation of a symbol the code no longer contains.
- [ ] Imports come from `react-native-worklets`, which is **already a direct dependency** in
      `package.json` (verified 2026-09-20) — so no dependency addition is expected. If that stops
      being true, re-check before importing: a merely transitive package passes locally and breaks
      on a clean install.
- [ ] Behaviour verified, not just types: the inline-drawer glide (`HomeScreen`), Toast dismissal,
      SwipeableRow gestures, the scroll-linked header, and camera focus/zoom all still work. A
      rename that type-checks but changes _when_ the worklet runs shows up as a visual glitch, never
      as a red test.
- [ ] Full suite green, with the test **count** compared against the pre-change baseline — not just
      "all green".

## Implementation Notes

- `scheduleOnUI` and `scheduleOnRN` are **not** guaranteed drop-in renames; the names imply a
  sync/schedule split that `runOnUI`/`runOnJS` did not have. Read the migration guide before
  assuming a mechanical find-and-replace is safe.
- Sequence the work by risk: `useSheetBackHandler.ts` (1) and `useCameraFocusAndZoom-utils.ts` (1)
  are the smallest; `useCameraFocusAndZoom.ts` (7, camera) is the largest and riskiest.
- Camera files cannot be verified in Expo Go — camera features need the dev-client build
  (`npx expo run:ios`). See the camera/upload gotchas before touching the four camera files.
- Consider splitting into two PRs (`runOnUI` alone, then `runOnJS`); a single 11-file PR gives
  reviewers no way to isolate a regression.

## Scope Contract

- **Mechanisms to use:** the documented Reanimated 3.x→4.x migration only. No refactor of the
  surrounding gesture/animation logic.
- **Files in scope:** exactly the eleven listed in the tables above. `package.json` is NOT expected
  to change, since `react-native-worklets` is already a direct dependency.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. Both symbols still function at `~4.3.1`.

## Out of scope — filed here so it is not lost

`client/screens/meal-plan/MealPlanHomeScreen.tsx` also carries four deprecated
`InteractionManager.runAfterInteractions` call sites (lines 817, 823, 837, 968; TS6387). That is a
**React Native** deprecation, not a Reanimated one, with a different migration path. Deliberately
excluded — file separately if it is worth doing.

## Risks

- Different scheduling semantics would surface as visual glitches, not test failures.
- `react-native-worklets` is already a direct dependency, so no new native module is introduced.
  If the migration turns out to need a newer version of it, that IS a dev-client rebuild, **not**
  an OTA-safe JS-only change.
- Four camera files are in scope, and camera behaviour cannot be verified in the simulator for
  capture paths.

## Updates

### 2026-09-20

- Filed from editor diagnostics during an unrelated `/todo` run. Deprecation text, replacement
  targets, per-file occurrence counts, and the pre-existing provenance (`e79d0427`/#959) all
  verified against `main` before filing.
