---
title: Do not use accessibilityLiveRegion on frequently updating content
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, talkback, live-region, performance]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Do not use accessibilityLiveRegion on frequently updating content

## Rule

`accessibilityLiveRegion="polite"` on Android triggers a TalkBack announcement **every time the content changes**. On a View that updates every 30 seconds (e.g., a countdown timer), this produces constant screen reader interruptions. Use `accessibilityLiveRegion` only on content that changes infrequently (e.g., error messages, status changes). For timer/countdown UIs, use `AccessibilityInfo.announceForAccessibility()` triggered by discrete state transitions, not continuous updates.

## Examples

```typescript
// BAD: Announces every 30-second countdown update
<View accessibilityLiveRegion="polite">
  <Text>Next phase in {formatDuration(remaining)}</Text>
</View>

// GOOD: Announce only on meaningful discrete events
const prevPhaseRef = useRef<string | null>(null);
useEffect(() => {
  if (currentPhase.name !== prevPhaseRef.current) {
    prevPhaseRef.current = currentPhase.name;
    AccessibilityInfo.announceForAccessibility(
      `You've entered the ${currentPhase.name} phase`,
    );
  }
}, [currentPhase.name]);
```

## Related Files

- `client/screens/FastingScreen.tsx` — phase transition announcements via effect, not live region
- Discovered during PR #25 performance + accessibility review

## See Also

- [Cross-platform live region announcements](../design-patterns/cross-platform-live-region-announcements-2026-05-13.md)
- [Dynamic accessibility announcements](../design-patterns/dynamic-accessibility-announcements-2026-05-13.md)
