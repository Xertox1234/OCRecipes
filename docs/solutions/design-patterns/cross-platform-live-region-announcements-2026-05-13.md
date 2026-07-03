---
title: Cross-platform live region announcements — announceForAccessibility only
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, live-region, talkback, voiceover, android]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Cross-platform live region announcements — announceForAccessibility only

## When this applies

Use `AccessibilityInfo.announceForAccessibility()` for all cross-platform screen reader announcements. Do **not** combine it with `accessibilityLiveRegion` — combining both causes TalkBack to announce the text twice on Android.

## Examples

```typescript
// Bad: causes double TalkBack announcements on Android
<View accessibilityLiveRegion="polite">
  <ThemedText>{statusText}</ThemedText>
</View>
useEffect(() => {
  AccessibilityInfo.announceForAccessibility(statusText);
}, [statusText]);

// Good: announceForAccessibility only — works on both iOS and Android
const isFirstRender = useRef(true);
useEffect(() => {
  if (isFirstRender.current) {
    isFirstRender.current = false;
    return;
  }
  AccessibilityInfo.announceForAccessibility(statusText);
}, [statusText]);
```

## Why

`accessibilityLiveRegion="polite"` triggers TalkBack to observe and announce DOM-like text changes. When paired with `announceForAccessibility`, TalkBack fires both its observer path and the explicit announcement — users hear the text spoken twice. Skip `accessibilityLiveRegion` entirely and rely on `announceForAccessibility` for cross-platform coverage.

**Skip mount announce:** Use an `isFirstRender` ref (as shown above) to suppress the initial announcement on mount — the component's visible state on render is sufficient context; repeating it via audio on every mount is disruptive.

**Announce ALL outcomes — success AND error:** A common omission is announcing only one branch. Screen reader users who submit a form or trigger an async action have no visual feedback; they must hear the result through an announcement. Both the success path and the error path need an announcement:

```typescript
// BAD — screen reader users never hear if saving succeeded
useEffect(() => {
  if (error)
    AccessibilityInfo.announceForAccessibility("Save failed: " + error);
}, [error]);

// GOOD — both outcomes are announced
useEffect(() => {
  if (error) {
    AccessibilityInfo.announceForAccessibility("Save failed: " + error);
  } else if (saveSucceeded) {
    AccessibilityInfo.announceForAccessibility("Recipe saved");
  }
}, [error, saveSucceeded]);
```

**Avoid re-firing on unrelated re-renders:** Use a prev-value ref (see "Ref Guard for One-Shot Effects") to fire announcements only when the relevant state transitions, not every time the component re-renders with the same value.

## Related Files

- audit 2026-05-09 H12

## See Also

- [Dynamic accessibility announcements](dynamic-accessibility-announcements-2026-05-13.md)
- [accessibilityLiveRegion on frequently updating content](../conventions/accessibilitylive-region-frequently-updating-content-2026-05-13.md)
- [Ref guard for one-shot effects](ref-guard-for-one-shot-effects-2026-05-13.md)
- [Skip-first-render guard for accessibility announcements](../conventions/skip-first-render-guard-accessibility-announcements-2026-05-13.md)
