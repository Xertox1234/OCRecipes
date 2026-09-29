---
title: "Home: sections can show an expanded chevron with no rows on first load"
status: in-progress
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, react-native, ux]
github_issue:
---

# Home: sections can show an expanded chevron with no rows on first load

## Summary

After a cold launch, Home's collapsible sections (Nutrition & Health, Recipes, Planning) can
show the expanded chevron and report `expanded` to accessibility, but render no rows. Tapping
the header collapses it; a second tap shows the rows. Find the cause and make the first
render show the rows.

## Background

Seen three times on the iPhone 17 simulator on 2026-09-26, on both `main` and the Quick Log
branch, right after launching the dev client:

- First launch: Nutrition & Health and Recipes showed the down chevron (expanded), with no
  rows under them; Planning showed its rows.
- A later launch: Recipes and Planning were expanded and empty.
- Maestro's view tree listed the section headers as `expanded` but had no row elements
  under them.

It makes the page look short and hides actions. Not yet reproduced on a device; it may be
a simulator timing effect (the section body is height-animated and measured on layout).

## Acceptance Criteria

- [x] Reproduce with a cold launch on the simulator (record how often, with screenshots) or
      show it does not reproduce on a device.
- [x] If reproducible: record the cause in Updates, then fix it so an expanded section shows
      its rows on the first render.
- [x] A test covers the fix where the logic is testable; otherwise simulator evidence.

## Implementation Notes

- Start in `client/components/home/CollapsibleSection.tsx` (height animation and measurement)
  and the persisted section state in `client/hooks/useHomeActions.ts` /
  `client/lib/home-actions-storage.ts`: the persisted "expanded" flag may apply before the
  body has measured, leaving a zero-height open section.
- Compare with `useCollapsibleHeight` (`client/hooks/useCollapsibleHeight.ts`), which the
  inline drawers use.

## Scope Contract

- **Mechanisms to use:** the existing collapsible-height measurement; no new animation
  mechanism.
- **Files in scope:**
  - `client/components/home/CollapsibleSection.tsx`
  - `client/hooks/useHomeActions.ts`, `client/lib/home-actions-storage.ts`
  - their co-located `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-09-26

- Filed while verifying the Quick Log fixes on the simulator.

### 2026-09-29

- **Reproduced reliably on the iPhone 17 simulator (iOS 26.5), cold launch via
  Metro + `launch_app_sim`/`stop_app_sim`: 5/5 launches showed at least one of
  Nutrition & Health / Recipes / Planning expanded with no rows** (screenshots
  captured per launch). Ruled out `FadeInDown` entering animation as the
  cause: forcing Reduce Motion on (`entering={undefined}` on all three section
  wrappers) reproduced the bug on 2/2 further launches — if anything, all
  three sections were empty both times, worse than without it.
- **Root cause**: `useCollapsibleHeight`'s `animatedHeight` shared value
  always starts at 0 (unlike `CollapsibleSection`'s own `chevronRotation`,
  which is initialized from `isExpanded`), and only snaps to the real content
  height once the content wrapper's first non-zero `onLayout` fires — this is
  Reanimated's own documented "measure-then-animate" idiom (its official
  `AccordionItem` example uses the identical scheme), not a misuse. On a
  section that is already expanded on mount (the cold-launch default in
  `DEFAULT_SECTIONS`, `client/lib/home-actions-storage.ts`), diagnostic
  logging showed the first `onLayout` firing promptly with the correct height
  and the hook's shared-value write happening synchronously inside it — but
  that write does not reliably reach the native view when it lands **before**
  the React commit that first attaches the Animated.View driven by this hook.
  A second, later write for the same measurement — issued from a `useEffect`,
  which by definition runs **after** that commit — is the one pattern that
  measurably works, matching how the existing user-triggered toggle expand
  (via `withTiming` in a post-commit effect) already worked correctly, and
  how the "Planning" section, which happened to receive extra natural
  re-layouts after mount, was the one section that never reproduced the bug.
  An initial fix attempt that instead suppressed the clip container's
  animated style on first render (omitting `animatedStyle` from the style
  array while unmeasured) passed unit tests but **did not fix the real bug on
  device** — Reanimated does not reliably re-attach a conditionally
  included/excluded animated style across renders. That approach was
  discarded before being committed.
- **Fix**: `CollapsibleSection.tsx` now re-forwards the first non-zero content
  measurement once more, in a `useEffect` gated on a local `hasMeasuredOnce`
  flip, so a section that starts already expanded gets a post-commit
  shared-value write even when its very first (pre-commit) write is lost.
  `useCollapsibleHeight.ts` (shared with `MicronutrientSection` and
  `HomeInlineDrawer`, and covered by a test that pins its zero-height-before-
  measurement contract) was left untouched, per the Scope Contract.
  Re-verified on device: 5/5 cold launches correct, plus 2/2 with Reduce
  Motion forced on.
- Unit test: `client/components/home/__tests__/CollapsibleSection.test.tsx`
  asserts the re-forward call pattern directly (`useCollapsibleHeight` is
  stubbed so the test targets `CollapsibleSection`'s own logic, not
  Reanimated's native style application, which jsdom cannot exercise).
