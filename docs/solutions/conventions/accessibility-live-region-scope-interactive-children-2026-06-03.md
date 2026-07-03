---
title: 'accessibilityLiveRegion on Text Node, Not Container, When Container Has Interactive Children'
track: knowledge
category: conventions
module: client
tags: [accessibility, react-native, android, talkback, live-region]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-06-03'
---

# accessibilityLiveRegion on Text Node, Not Container, When Container Has Interactive Children

## Rule

When an error container View holds both a text element AND a `Pressable` (e.g. "Try Again"), place `accessibilityLiveRegion="assertive"` on the `Text`/`ThemedText` node directly — not on the container `View`.

## Why

Android TalkBack's live-region implementation announces the concatenated text content of the entire subtree when the region changes. If the container holds both error text and a "Try Again" button, TalkBack will announce:

> "Could not complete the upgrade. Please try again. Try again"

The error message and the button label get merged into one announcement, which is confusing and redundant.

Placing the live region on the text node alone confines the announcement to only the error copy. The `Pressable` remains its own independent accessibility node that TalkBack can focus and activate separately.

## Smell patterns

- An error `View` that has `accessibilityLiveRegion` AND contains a child `Pressable`
- A `View` styled as `errorContainer` where the only child is a `ThemedText` — safe to put the live region on the container in this case (BeveragePickerSheet pattern)

## Examples

**Wrong — live region on container that has an interactive child:**

```tsx
<View style={styles.errorContainer} accessibilityLiveRegion="assertive">
  <ThemedText style={{ color: theme.error }}>
    {errorMessage}
  </ThemedText>
  <Pressable onPress={handleRetry} accessibilityRole="button">
    <ThemedText>Try Again</ThemedText>
  </Pressable>
</View>
```

TalkBack announces: *"Could not complete the upgrade. Please try again. Try again"*

**Correct — live region scoped to the text node:**

```tsx
<View style={styles.errorContainer}>
  <ThemedText
    style={{ color: theme.error }}
    accessibilityLiveRegion="assertive"
  >
    {errorMessage}
  </ThemedText>
  <Pressable onPress={handleRetry} accessibilityRole="button">
    <ThemedText>Try Again</ThemedText>
  </Pressable>
</View>
```

TalkBack announces: *"Could not complete the upgrade. Please try again"* — then the user can navigate to "Try Again" independently.

## Exceptions

If the error container only contains text (no interactive children), placing `accessibilityLiveRegion` on the container is fine and equivalent.

## Related Files

- `client/components/UpgradeModal.tsx` — live region on `ThemedText` at the error state
- `client/components/BeveragePickerSheet.tsx` — live region on container (text-only, no children Pressable)

## See Also

- [double-talkback-announcements-live-region](../logic-errors/double-talkback-announcements-live-region-2026-05-13.md) — the pairing problem between liveRegion and announceForAccessibility
- [accessibility-modal-portal-bottom-sheet](../logic-errors/accessibility-modal-portal-bottom-sheet-2026-05-13.md) — related VoiceOver/TalkBack scoping pitfalls
