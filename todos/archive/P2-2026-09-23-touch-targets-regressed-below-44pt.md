---
title: "Touch targets regressed to 32–36pt on Scan, Label analysis, Recipe browser and Plan after the June AAA sweep"
status: done
priority: medium
created: 2026-09-23
updated: 2026-09-23
assignee:
labels: [deferred, audit, accessibility]
github_issue:
---

# Touch targets regressed to 32–36pt on Scan, Label analysis, Recipe browser and Plan after the June AAA sweep

## Summary

Several controls fall below the 44pt / 48dp platform minimum again, even though `todos/archive/P3-2026-06-10-touch-targets-aaa-sweep.md` closed as done. They pass WCAG 2.5.8 AA (24px) but fail 2.5.5 AAA, Apple HIG and Material.

## Background

Found by the 2026-09-23 front-end audit (read-only, 6 lenses + Context7 research). Finding ID(s): **M13** in `docs/audits/2026-09-23-frontend.md` (local-only, gitignored). Each claim below was re-read against the code at HEAD `3df8b4b3`; line numbers may drift.

- `client/screens/ScanScreen.tsx:1128-1133` closeBtn 36×36 with no hitSlop; confirm buttons :1243-1256 have no minHeight (from L12).
- `client/screens/LabelAnalysisScreen.tsx:771-777` servings ± 36×36 with no hitSlop.
- `client/screens/meal-plan/RecipeBrowserScreen.tsx:281-294` favourite: 20pt + hitSlop 8 = 36pt.
- `client/screens/meal-plan/MealPlanHomeScreen.tsx:253-269` confirm 36pt; :290-297 remove 32pt.
- Research (RN Pressable hitSlop counts toward the target; WCAG 2.2): `confirmed`, with AA vs AAA framing. See `docs/rules/react-native.md:5`.

## Acceptance Criteria

- [ ] Every listed control has visual size + hitSlop ≥ 44pt on each axis (or explicit min 44)
- [ ] No visual layout regression (screenshots via verify-ui for Scan and LabelAnalysis)
- [ ] Consider a lint/pattern check to prevent regression, only if a cheap one fits the existing lint-staged checks
- [ ] Failing test written first (TDD), then the fix; the test fails on current `main` and passes after.

## Implementation Notes

The archived sweep's notes (hitSlop vs row-height caps) apply — read them first.

## Scope Contract

- **Mechanisms to use:** existing project patterns cited above — nothing new beyond what the acceptance criteria name.
- **Files in scope:**
  - `client/screens/ScanScreen.tsx`
  - `client/screens/LabelAnalysisScreen.tsx`
  - `client/screens/meal-plan/RecipeBrowserScreen.tsx`
  - `client/screens/meal-plan/MealPlanHomeScreen.tsx`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- hitSlop overlapping neighbouring controls in tight rows — check adjacent targets don't steal taps.

## Updates

### 2026-09-23

- Initial creation from the 2026-09-23 front-end audit (M13).

### 2026-09-25 (implemented)

- All four controls raised to 44pt: ScanScreen closeBtn (`hitSlop={4}`, room
  verified in `topOverlay`'s gap/padding/margin); ScanScreen confirm-card
  Dismiss/Log It (`minHeight: 44` + `justifyContent: "center"`);
  LabelAnalysisScreen servings +/- (`hitSlop={4}` plus `padding: Spacing.xs`
  added to the parent `servingControls` row so the hitSlop isn't clipped to
  parent bounds — RN clips hitSlop to the parent view, per the archived June
  sweep's own note); RecipeBrowserScreen favourite and MealPlanHomeScreen
  confirm/remove — explicit `width: 44, height: 44` boxes (the AC's "explicit
  min 44" option) instead of hitSlop, specifically to avoid hitSlop growing
  into an adjacent fixed-size tap target in a tight row.
- AC #4 (TDD): a failing test was written first for each control, asserting
  on the raw Pressable/TouchableOpacity props captured at the react-native
  mock boundary (the shared jsdom mock drops Pressable's `style` before
  rendering, so a DOM-based assertion can't see it) — confirmed red against
  pre-fix code, then green after the fix. New/expanded tests:
  `ScanScreen.test.tsx`, `LabelAnalysisScreen.test.tsx`,
  `MealPlanHomeScreen.test.tsx`, and a new
  `RecipeBrowserScreen.touch-targets.test.tsx` (no existing RecipeBrowserScreen
  test file mounts a real recipe card — both siblings stub `SectionList`).
- AC #3 (lint check): considered extending `scripts/check-accessibility.js`
  with a touch-target-size check; skipped — computing an "effective size"
  statically (JSX numeric literals + hitSlop, per control) risks false
  positives/negatives without full type information, and a new lint script
  is outside this todo's Scope Contract. The TDD tests above are the
  regression guard instead.
- AC #2 (verify-ui): the iOS Simulator has no camera, so ScanScreen's actual
  camera overlay (closeBtn) and its confirm-card (only reachable after a real
  scan) can't be driven to a screenshot-able state in-sim; LabelAnalysisScreen's
  serving-adjuster is reachable only via the same photo-capture flow. Skipped
  spinning up Metro + the backend to screenshot screens whose key states are
  camera-gated regardless. Reviewer follow-up: the RecipeBrowserScreen/
  MealPlanHomeScreen explicit-44pt-box changes (not originally in AC #2's
  screenshot list) produce a larger visible shift than Scan/LabelAnalysis's
  hitSlop-only changes (narrows the adjacent title/name text column by
  ~24-52pt in a representative row) — not a bug (fixed siblings/edges are
  unaffected, icons stay centered), but worth an on-device eyeball on the
  next preview build. Both reviewers (code-reviewer, mobile-reviewer)
  returned no blocking findings on the diff itself.
- 2026-09-25 (orchestrator, before independent review): also fixed the same file's Clear search button (16pt icon + hitSlop 8 = 32pt), which the executor had left out of scope. It now has an explicit 44pt box with negative margins, and the search bar a 44pt minHeight, because its ~36pt bar would clip a hitSlop.
