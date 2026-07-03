---
title: Dynamic loading state labels for buttons and indicators
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, loading, buttons, voiceover]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Dynamic loading state labels for buttons and indicators

## When this applies

Update `accessibilityLabel` to reflect loading state for buttons and actions. Screen reader users need to know when an action is in progress.

## Examples

```typescript
<Button
  onPress={handleSubmit}
  disabled={isLoading}
  accessibilityLabel={
    isLoading
      ? mode === "login" ? "Signing in" : "Creating account"
      : mode === "login" ? "Sign In" : "Create Account"
  }
>
  {isLoading ? <ActivityIndicator /> : mode === "login" ? "Sign In" : "Create Account"}
</Button>
```

### For loading indicators

```typescript
function LoadingFooter() {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading more items"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}
```

## Why

`accessibilityLiveRegion="polite"` announces the content when it appears without interrupting current speech. Combined with a state-aware label, screen reader users get continuous awareness of progress.

## See Also

- [Skeleton loader pattern](skeleton-loader-pattern-2026-05-13.md)
- [Cross-platform live region announcements](cross-platform-live-region-announcements-2026-05-13.md)
