---
title: "Seven spring configs omit mass, so Reanimated 4 runs them at mass 4 — 29–77% overshoot and 1.6–3.6 s settles instead of the ~450 ms their own comments assume"
status: backlog
priority: medium
created: 2026-10-20
updated: 2026-10-20
assignee:
labels: [deferred, ui, react-native]
github_issue:
---

# Spring configs without `mass` run at Reanimated 4's default mass of 4

## Summary

Reanimated 4's `withSpring` fills any missing option from `GentleSpringConfig`
(`{ damping: 120, mass: 4, stiffness: 900 }`; `node_modules/react-native-reanimated/src/animation/spring/spring.ts:65`,
installed 4.3.1). Reanimated 3 filled in `mass: 1`. Seven configs in
`client/constants/animations.ts` set `damping`/`stiffness` but no `mass`, so at runtime each is
half as fast and half as damped as a mass-1 reading of its numbers. Layout-animation builders
behave the same: `ComplexAnimationBuilder` only forwards `mass` when `.mass()` is called.

The code's own documentation assumes mass 1: `streamBlockEntranceHoldMs` (animations.ts:136-140)
is sized for the `chatBubbleEntrySpring` entrance "to settle (~450ms at damping 18 / stiffness 150)".
At mass 4 that spring is at 127% of its travel at 500 ms, near its 129% peak, so the saved copy
replaces the assistant's bubble mid-overshoot.

## Background

Found 2026-10-20 while building a spring-conversion tool for the front-end design research (the
tool ports Reanimated 4's and Motion's spring solvers; see the design-craft skill once installed).
The project has been on Reanimated `~4` since at least ee72b8c2 (2026-01-22). The configs were
lifted from inline literals into named constants in #1317 (2026-10-06); the literals predate it.

## Measurements (from rest; ratio = damping / (2·√(stiffness·mass)), ω0 = √(stiffness/mass))

| Config (used in)                                                          | As written → mass 4 at runtime                     | Same numbers at mass 1 |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------- |
| `chatBubbleEntrySpring` 18/150 (`ChatBubble.tsx` assistant `SlideInLeft`) | ratio 0.367, overshoot 28.9%, within 1% at 1876 ms | 0.735, 3.3%, 539 ms    |
| `dateStripSnapBackSpringConfig` 20/200 (`MealPlanHomeScreen.tsx:1319`)    | 0.354, 30.5%, 1629 ms                              | 0.707, 4.3%, 466 ms    |
| `bannerEntrySpring` 20/200 (`OfflineBanner.tsx`, `Toast.tsx`)             | 0.354, 30.5%, 1629 ms                              | 0.707, 4.3%, 466 ms    |
| `speedDialEntrySpring` 16/180 (`SpeedDial.tsx:127`)                       | 0.298, 37.5%, 2137 ms                              | 0.596, 9.7%, 466 ms    |
| `sendButtonEntrySpring` 14/260 (`CoachChatBase.tsx:158`)                  | 0.217, 49.7%, 2508 ms                              | 0.434, 22.0%, 672 ms   |
| `stepCheckSpringConfig` `{ damping: 10 }` (`StepPill.tsx:44`)             | stiffness 900 by default: 0.083, 76.9%, 3608 ms    | —                      |
| `reticleSettleSpringConfig` `{ damping: 12 }` (`ScanReticle.tsx:164`)     | 0.100, 72.9%, 2988 ms                              | —                      |

`StepPill`: the check springs 1 → 1.25 and starts back to 1 in the completion callback. At ratio
0.083 it peaks at 1.44× and the callback (energy below 6e-9) fires at ~7.6 s, so the check sits
enlarged for seconds before the "pop" returns. The user's chat bubble is unaffected: `.duration(200)`
switches the builder to duration mode, which ignores damping/stiffness. Configs with explicit
`mass` (`pressSpringConfig`, `toastSpringConfig`, `tabIconPopConfig`, `successPopConfig`) are
unaffected.

Reading the written numbers hides this: `toastSpringConfig` (20 / mass 0.4 / 200) and
`bannerEntrySpring` (20 / – / 200) look like near-duplicates, but the first is overdamped (ratio
1.12, no overshoot) and the second overshoots 30%. `Toast.tsx` uses both — `withSpring(0,
toastSpringConfig)` at :120 and the `SlideInUp.springify()` entrance with the banner values at :131.

For scale: Apple calls bounce above ~0.4 (≈9.5% overshoot) "too exaggerated for a UI element"
(WWDC23 "Animate with springs"); Material 3 Expressive's bounciest spatial spring is 9.5%.

## Acceptance Criteria

- [ ] Every spring config and spring layout builder in `client/` states `mass` explicitly (or uses
      duration mode on purpose), so the library default can't silently apply.
- [ ] The intended feel of each of the seven is decided — the documented intent (e.g. ~450 ms for
      the chat bubble) is the starting point; check with the owner before making any of them
      bouncier than a mass-1 reading.
- [ ] `StepPill`'s pop returns to 1 when the pop visibly settles, not seconds later.
- [ ] `streamBlockEntranceHoldMs` matches the bubble entrance's real settle time.
- [ ] A Vitest test over `client/constants/animations.ts` fails when a `WithSpringConfig` (or a
      `{ damping, stiffness }` builder spec) omits `mass` and is not in duration mode.
- [ ] Simulator check (screen recording, not a still) of the StepPill pop, the reticle lock and
      a Coach reply bubble entrance.

## Implementation Notes

- Converting a spring between notations by hand is error-prone (Reanimated duration mode is a
  solver, not a formula). Use the design-craft skill's `springs.mjs` once installed, e.g.
  `node springs.mjs reanimated damping=18 stiffness=150` prints the mass-4 behaviour and the
  mass-1 equivalent in every notation.
- `stepCheckSpringConfig` / `reticleSettleSpringConfig` set damping only; their stiffness comes
  from the default (900), so pick both values deliberately rather than just adding `mass`.
- The reduced-motion paths (`reducedMotion` checks) are already in place; keep them.

## Scope Contract

- **Mechanisms to use:** explicit `mass` (or duration mode) in the existing configs; one Vitest test.
- **Files in scope:** `client/constants/animations.ts`, its `__tests__/`, and the seven call sites
  listed above if a builder chain needs `.mass()`.
- No new animation libraries; no change to which elements animate.

## Dependencies

- None blocking. Related: `todos/P2-2026-10-20-text-inputs-bypass-shared-focus-feedback.md`
  (same design research).
