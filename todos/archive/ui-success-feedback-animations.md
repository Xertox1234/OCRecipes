---
title: "Add success feedback animations for key actions"
status: in-progress
priority: low
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, animation, ux]
---

# Success Feedback Animations

## Summary

Add inline success animations when key actions complete (food logged, recipe saved, barcode scanned), going beyond haptic feedback and toasts to provide more connected visual confirmation.

## Background

The app uses haptics (85 files) and Toast notifications for action feedback. Adding brief inline animations on the triggering element (not just a distant toast) creates a stronger feedback loop. The existing Reanimated 4 infrastructure supports this well.

## Acceptance Criteria

- [ ] Barcode scan success: brief green flash/scale animation on the scanned item card
- [ ] Food logged (QuickLog): checkmark animation that draws itself, then fades
- [ ] Recipe saved/favorited: heart icon scale-pop (1.0 → 1.4 → 1.0) with color fill
- [ ] Grocery item checked off: subtle strikethrough animation (left-to-right line draw)
- [ ] All animations respect `reducedMotion` (instant state change, no animation)
- [ ] Animations are ≤300ms duration, non-blocking
- [ ] Tests pass

## Implementation Notes

- For checkmark draw animation: use `react-native-svg` with animated `strokeDashoffset` (same pattern as `ProgressRing`)
- Heart pop: `withSequence(withSpring(1.4), withSpring(1))` with the existing `pressSpringConfig`
- Green flash: brief `withTiming` on background opacity (0 → 0.15 → 0) over 300ms
- Strikethrough: `withTiming` on a line width from 0 to text width
- Consider creating a reusable `useSuccessAnimation()` hook that returns `{ trigger, animatedStyle }`
- Keep animations GPU-bound (only `transform` and `opacity`)

## Dependencies

- `react-native-svg` (already installed) for checkmark draw animation

## Risks

- Over-animation risk — keep effects subtle and fast
- Must not interfere with touch targets or block interaction during animation
- Checkmark SVG animation path needs careful coordinate calculation

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
