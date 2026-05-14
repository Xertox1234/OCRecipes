---
title: "Query error retry pattern with accessible Retry button"
track: knowledge
category: design-patterns
tags: [react-native, tanstack-query, error-handling, retry, accessibility]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
created: 2026-05-13
---

# Query error retry pattern with accessible Retry button

## When this applies

Provide retry functionality for failed data fetching with accessible controls. Users should always have a way to recover from transient errors without navigating away.

## Examples

```typescript
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ["/api/dietary-profile"],
  // ...
});

// In error UI
{isError && (
  <View style={styles.errorContainer}>
    <ThemedText>Failed to load preferences</ThemedText>
    <Pressable
      onPress={() => refetch()}
      accessibilityLabel="Retry loading dietary preferences"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.retryButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="refresh-cw" size={14} />
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
)}
```

## Why

Users should always have a way to recover from transient errors without navigating away. The retry button provides an immediate action rather than requiring a pull-to-refresh or screen reload.

## See Also

- [Error feedback: toast.error + haptics](error-feedback-toast-error-haptics-2026-05-13.md)
- [Coordinated pull-to-refresh for multiple queries](coordinated-pull-to-refresh-multiple-queries-2026-05-13.md)
