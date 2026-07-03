---
title: Non-interactive accessibilityRole="checkbox" misleads screen readers
track: bug
category: logic-errors
module: client
severity: high
tags: [accessibility, react-native, voiceover, talkback, screen-readers]
symptoms: ['VoiceOver/TalkBack announces a non-interactive view as "checkbox, checked" then the gesture does nothing', Users expect tap-to-toggle but the actionable element is a sibling button, Code review (round 2) escalates a checkbox-role finding to CRITICAL]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-10'
---

# Non-interactive accessibilityRole="checkbox" misleads screen readers

## Problem

Applying `accessibilityRole="checkbox"` (plus `accessibilityState={{ checked }}`) to a plain `View` that has no `onPress` handler is misleading: VoiceOver/TalkBack users hear "checkbox, checked" and expect to toggle it, but the gesture does nothing because the actionable element is a sibling `Pressable` (e.g., an "Accept" button) that triggers the state change. The discovery came from coach `CommitmentCard`, where an audit prescribed exposing the checkmark indicator with the checkbox role; kimi-review (round 2) escalated this to CRITICAL.

## Symptoms

- Screen reader users hear "checkbox" but cannot toggle it via the activation gesture
- The visible checkbox icon is decorative, not interactive
- The actual state-changing control is elsewhere in the row

## Root Cause

`accessibilityRole="checkbox"` is a contract: the focused element is expected to toggle its own state. Setting that role on a non-actionable `View` violates the contract — VoiceOver's activation gesture does nothing because the `Pressable` that owns state lives outside the focused element.

## Solution

For status indicators that are visually checkbox-like but not independently actionable, mark them `accessible={false}` (and `importantForAccessibility="no"` for Android symmetry) and roll the state into the parent group's `accessibilityLabel`:

```tsx
// Good — state conveyed by parent label, indicator is decorative
<View
  role="group"
  accessibilityLabel={`${accepted ? "Accepted commitment" : "Commitment"}: ${title}. ${followUpText}`}
>
  <View
    style={[styles.checkbox, accepted ? styles.filled : styles.outlined]}
    accessible={false}
    importantForAccessibility="no"
  >
    {accepted && <Text accessible={false}>✓</Text>}
  </View>
  …
  <Pressable accessibilityRole="button" onPress={accept}>Accept</Pressable>
</View>

// Bad — non-actionable View pretending to be a checkbox
<View
  accessible
  accessibilityRole="checkbox"
  accessibilityState={{ checked: accepted }}
/>
```

## Prevention

`accessibilityRole="checkbox"` should only be used on a `Pressable` (or other actionable component) that actually toggles its own state. If the surrounding UX makes the checkbox the active control, fine — otherwise leave it decorative and convey state in a parent label.

## Related Files

- `client/components/coach/CommitmentCard.tsx`
- `docs/legacy-patterns/react-native.md` — "Parent Label Prefix for Decorative Child Elements"

## See Also

- [Parent label prefix for decorative children](../conventions/parent-label-prefix-decorative-children-2026-05-13.md)
