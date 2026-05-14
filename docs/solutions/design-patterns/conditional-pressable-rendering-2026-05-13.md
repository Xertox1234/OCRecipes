---
title: "Conditional Pressable rendering — View when no onPress, Pressable when provided"
track: knowledge
category: design-patterns
tags: [react-native, pressable, touch, wrapper-components]
module: client
applies_to: ["client/components/**/*.tsx"]
created: 2026-05-13
---

# Conditional Pressable rendering — View when no onPress, Pressable when provided

## When this applies

When building reusable wrapper components (Card, ListItem, Container) that may or may not be interactive, conditionally render as `View` or `Pressable` based on whether `onPress` is provided. Always-`Pressable` wrappers cause nested-Pressable bugs where the outer parent's `onPress` never fires.

## Examples

```typescript
// Good: Renders as View when not interactive
export function Card({ children, onPress, style }: CardProps) {
  const content = <>{children}</>;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.card, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{content}</View>;
}

// Usage - Card passes through touch events to parent
<Pressable onPress={handleNavigate}>
  <Card>  {/* Renders as View, doesn't block touches */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

```typescript
// Bad: Always renders as Pressable
export function Card({ children, onPress, style }: CardProps) {
  return (
    <Pressable onPress={onPress} style={[styles.card, style]}>
      {children}
    </Pressable>
  );
}

// Problem - nested Pressables block touch events
<Pressable onPress={handleNavigate}>  {/* This onPress never fires! */}
  <Card>  {/* Inner Pressable captures and swallows the touch */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

## Why

In React Native, nested `Pressable` components cause the inner one to capture touch events. If the inner `Pressable` has no `onPress` handler, the touch is swallowed and the parent never receives it.

## Exceptions

When to use: any reusable component (Card, ListItem, Container) that wraps content and may optionally be tappable.

## Related Files

- `client/components/Card.tsx` (and similar wrappers)
