---
title: "Add keyboardShouldPersistTaps to HomeScreen ScrollView"
status: done
priority: medium
created: 2026-05-02
updated: 2026-05-02
assignee:
labels: [deferred, audit-2026-05-02, react-native]
---

# Add keyboardShouldPersistTaps to HomeScreen ScrollView

## Summary

`Animated.ScrollView` on `HomeScreen` has no `keyboardShouldPersistTaps` prop (defaults to `"never"`). The first chip tap while the keyboard is open is consumed by the scroll view to dismiss the keyboard — the chip `onPress` never fires, requiring a second tap.

## Background

Deferred from 2026-05-02 full audit (finding M7). `client/screens/HomeScreen.tsx` lines 132-151. This affects the QuickLogDrawer frequent-item chips — the user types in the text input, the keyboard opens, they tap a chip to reuse a food, and nothing happens on the first tap.

## Acceptance Criteria

- [ ] `Animated.ScrollView` (or its wrapper) has `keyboardShouldPersistTaps="handled"`
- [ ] First chip tap while keyboard is open correctly fires the chip's `onPress`

## Implementation Notes

`keyboardShouldPersistTaps="handled"` passes taps through to child `onPress` handlers while still dismissing the keyboard when tapping non-interactive areas. `"always"` would also work but suppresses keyboard dismissal entirely.

## Dependencies

- None

## Risks

- `"handled"` vs `"always"` choice affects UX when tapping non-interactive scroll areas — test both

## Updates

### 2026-05-02

- Initial creation (deferred from audit M7)
