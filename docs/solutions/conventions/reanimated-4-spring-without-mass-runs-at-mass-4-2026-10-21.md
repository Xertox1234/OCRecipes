---
title: 'Every Reanimated spring states mass — Reanimated 4 fills a missing one with 4, not 1'
track: knowledge
category: conventions
module: client
tags: [reanimated, spring, animation, mass, react-native]
applies_to: [client/constants/animations.ts, client/components/**/*.tsx, client/camera/components/*.tsx]
created: '2026-10-21'
---

# Every Reanimated spring states mass

## Rule

Every `withSpring` config and every layout-builder spring (`.springify().damping().stiffness()`) in `client/` sets `mass` explicitly (chain `.mass()` on builders), or is deliberately in duration mode.

## Why

Reanimated 4 fills any omitted spring option from `GentleSpringConfig` (`damping 120, mass 4, stiffness 900`); Reanimated 3 filled `mass: 1`. A `{ damping: 18, stiffness: 150 }` config therefore ran at mass 4: 29% overshoot and a ~1.9 s settle instead of 3% and ~540 ms. A damping-only config also inherits stiffness 900.

## Examples

Share one const per spring and read `mass` from it at the builder: `.damping(s.damping).mass(s.mass).stiffness(s.stiffness)`. `client/constants/__tests__/animations.test.ts` fails when an exported spring omits `mass`. Convert between notations with the crafting-ui skill's `scripts/springs.mjs`, not by hand.

## Exceptions

Duration-mode springs (`.duration(n)` / `duration` in the config) ignore damping, stiffness and mass.

## Related Files

- `client/constants/animations.ts`
- `client/constants/__tests__/animations.test.ts`
