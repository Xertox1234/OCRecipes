---
title: "accessibilityLiveRegion + announceForAccessibility causes double TalkBack announcements"
track: bug
category: logic-errors
tags: [accessibility, react-native, talkback, voiceover, live-region]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms:
  - "TalkBack reads the same status text twice in rapid succession"
  - 'Adding `accessibilityLiveRegion="polite"` to a view that already uses `announceForAccessibility` causes duplicate speech'
  - "kimi-review flags double-announcement on selection-count chip"
created: 2026-05-10
severity: medium
---

# accessibilityLiveRegion + announceForAccessibility causes double TalkBack announcements

## Problem

`accessibilityLiveRegion="polite"` instructs TalkBack to observe DOM-like content changes in the view tree and announce them automatically. `AccessibilityInfo.announceForAccessibility()` is an explicit imperative announcement. When both are active on the same content change, TalkBack fires both its observer path and the explicit call — the user hears the text spoken twice in rapid succession.

## Symptoms

- TalkBack repeats a chip/status label as soon as content changes
- iOS VoiceOver behaves correctly; only Android TalkBack double-fires
- Selection-count or progress-update text is the most common offender

## Root Cause

`accessibilityLiveRegion` and `announceForAccessibility` are independent announcement paths. Both fire on the same content change; TalkBack has no de-duplication.

## Solution

For polite status updates (selection counts, progress indicators), use **only** `announceForAccessibility`. Remove `accessibilityLiveRegion` entirely:

```tsx
// Bad — double announcement on Android
<View accessibilityLiveRegion="polite">
  <Text>{`${count} selected`}</Text>
</View>
// + useEffect(() => AccessibilityInfo.announceForAccessibility(`${count} selected`), [count])

// Good — single explicit announcement
<View>
  <Text>{`${count} selected`}</Text>
</View>
// + useEffect(() => AccessibilityInfo.announceForAccessibility(`${count} selected`), [count])
```

For errors, `accessibilityRole="alert"` handles the announcement without needing `accessibilityLiveRegion`. Only use `accessibilityLiveRegion` when you are NOT also calling `announceForAccessibility` for the same content.

## Prevention

Audit any component that uses both APIs. The pattern docs at `docs/legacy-patterns/react-native.md` previously recommended the pairing — this was incorrect and has been updated. Note that an `isFirstRender` ref still needs to skip the mount announce when using `announceForAccessibility` alone.

## Related Files

- `client/screens/TastePicksScreen.tsx` — selection-count chip
- `docs/legacy-patterns/react-native.md` — updated to remove the pairing recommendation

## See Also

- [accessibilityLiveRegion frequently updating content](../conventions/accessibilitylive-region-frequently-updating-content-2026-05-13.md)
- [Skip first render guard accessibility announcements](../conventions/skip-first-render-guard-accessibility-announcements-2026-05-13.md)
