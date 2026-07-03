---
title: Dynamic accessibility announcements via AccessibilityInfo
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, announcements, voiceover, talkback]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Dynamic accessibility announcements via AccessibilityInfo

## When this applies

Announce important state changes that aren't reflected in focus — async operation outcomes, content updates not caused by user navigation, timer-based notifications.

## Examples

```typescript
import { AccessibilityInfo } from "react-native";

// Announce scan success
const handleBarcodeScanned = async (barcode: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility("Barcode scanned successfully");
  // Process barcode...
};

// Announce errors
const handleError = (message: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility(`Error: ${message}`);
};
```

## Why

Screen reader users navigate by focus. Async state changes that don't move focus (a toast appearing, a barcode firing, a save completing) are invisible to them without an explicit announcement.

## Exceptions

When to use:

- Success/error states after async operations
- Content updates not caused by user navigation
- Timer-based notifications

Do not combine `announceForAccessibility` with `accessibilityLiveRegion` — TalkBack will announce twice. See cross-platform live region pattern.

## See Also

- [Cross-platform live region announcements](cross-platform-live-region-announcements-2026-05-13.md)
- [Skip-first-render guard for accessibility announcements](../conventions/skip-first-render-guard-accessibility-announcements-2026-05-13.md)
- [accessibilityLiveRegion on frequently updating content](../conventions/accessibilitylive-region-frequently-updating-content-2026-05-13.md)
