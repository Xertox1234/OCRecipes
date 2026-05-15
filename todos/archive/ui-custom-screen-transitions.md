---
title: "Add custom screen transitions for key navigation flows"
status: in-progress
priority: low
created: 2026-04-12
updated: 2026-04-12
assignee:
labels: [ui, animation, polish]
---

# Custom Screen Transitions

## Summary

Add custom transition animations for specific navigation flows instead of using React Navigation defaults for everything. Focus on transitions where spatial continuity or visual feedback matters.

## Background

All navigators currently use React Navigation v7 default transitions (slide-from-right on iOS, fade on Android). Some flows would benefit from custom transitions that reinforce the spatial relationship between screens.

## Acceptance Criteria

- [ ] Scan FAB → ScanScreen: scale-from-FAB-position transition (camera "grows" from the button)
- [ ] PhotoIntent → PhotoAnalysis: cross-fade with subtle scale (photo "processing" effect)
- [ ] Tab switches: optional cross-fade instead of instant swap
- [ ] All custom transitions respect `useReducedMotion()` — fall back to instant swap
- [ ] No performance regression (measure FPS during transitions)
- [ ] Tests pass

## Implementation Notes

- React Navigation v7 native-stack has limited transition customization vs JS stack
- For `fullScreenModal` screens, use `animation` prop: `"fade"`, `"slide_from_bottom"`, `"fade_from_bottom"`
- FAB → Scan scale transition may require a shared element library or custom transition config
- Consider `react-native-shared-element` or React Navigation's built-in shared element support
- Tab cross-fade: look at `tabBarAnimation` options in `@react-navigation/bottom-tabs`

## Dependencies

- May need `react-native-shared-element` for shared element transitions
- Native stack vs JS stack decision affects available transition APIs

## Risks

- Native stack has fewer transition options than JS stack
- Shared element transitions can be janky on lower-end Android devices
- Performance must be tested on real devices, not just simulator

## Updates

### 2026-04-12

- Initial creation during UI improvement audit
