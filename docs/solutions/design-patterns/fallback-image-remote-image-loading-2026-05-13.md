---
title: FallbackImage for remote image loading with themed placeholder
track: knowledge
category: design-patterns
module: client
tags: [react-native, images, fallback, error-handling, components]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# FallbackImage for remote image loading with themed placeholder

## When this applies

Remote images (recipe photos, avatars, scanned item thumbnails) can fail to load due to 404s, network errors, or corrupted URLs. Use the `FallbackImage` component to automatically show a themed placeholder on failure, preventing blank/broken image states.

## Examples

```typescript
import { FallbackImage } from "@/components/FallbackImage";

// Basic usage — default icon placeholder
<FallbackImage
  source={{ uri: recipe.imageUrl ?? undefined }}
  style={styles.recipeImage}
  fallbackIcon="image"
  fallbackIconSize={24}
  accessibilityLabel={`Photo of ${recipe.title}`}
/>

// Custom icon color — when the original design uses an accent color
<FallbackImage
  source={{ uri: user.avatarUrl ?? undefined }}
  style={styles.avatar}
  fallbackStyle={{ backgroundColor: withOpacity(theme.link, 0.12) }}
  fallbackIcon="user"
  fallbackIconColor={theme.link}
/>

// Custom fallback element — when you need a non-standard placeholder
<FallbackImage
  source={{ uri: imageUri ?? undefined }}
  style={StyleSheet.absoluteFill}
  fallback={
    <View style={styles.customPlaceholder}>
      <Feather name="image" size={32} color={theme.textSecondary} />
    </View>
  }
/>
```

## Why

**Key details:**

- Always convert nullable strings with `?? undefined` before passing to `source` — `FallbackImage` handles `undefined` but nullable `string | null` types should be explicit
- `fallbackIconColor` defaults to `theme.textSecondary` — override when the original design used an accent color (e.g., `theme.link` for avatars)
- `fallbackStyle` merges with `style` on the fallback `View` — use it for different background colors without duplicating dimensions
- `hasError` state resets automatically when the source URI changes, so dynamic updates (e.g., user uploads new avatar) work without remounting
- The companion `FallbackImage-utils.ts` exports `hasValidUri()` as a pure testable type guard

## Exceptions

When to use: any `<Image>` that loads a remote URL (recipe images, avatars, product photos, community content). NOT needed for locally-captured images (camera photos, image picker results) which are guaranteed to exist.

## Related Files

- `client/components/FallbackImage.tsx` — component implementation
- `client/components/FallbackImage-utils.ts` — `hasValidUri()` type guard
- `client/screens/ProfileScreen.tsx` — avatar with `fallbackIconColor={theme.link}`
- `client/screens/HistoryScreen.tsx` — scanned item thumbnails with "package" icon

## See Also

- [Reset derived state on prop change](../conventions/reset-derived-state-on-prop-change-2026-05-13.md)
