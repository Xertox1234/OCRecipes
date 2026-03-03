---
title: "Migrate TouchableOpacity to Pressable in NutritionDetailScreen"
status: backlog
priority: low
created: 2026-02-27
updated: 2026-02-27
assignee:
labels: [consistency, client, tech-debt]
---

# Migrate TouchableOpacity to Pressable

## Summary

`NutritionDetailScreen.tsx` is the only screen still using `TouchableOpacity` (11 instances). The rest of the codebase uses `Pressable`. Migrate for consistency.

## Acceptance Criteria

- [ ] All 11 `TouchableOpacity` usages replaced with `Pressable` in `NutritionDetailScreen.tsx`
- [ ] Import removed from react-native imports
- [ ] Visual behavior preserved (opacity feedback via Pressable style function)
- [ ] Accessibility labels preserved on all interactive elements

## Implementation Notes

Replace:
```tsx
<TouchableOpacity onPress={handler} style={styles.button}>
```

With:
```tsx
<Pressable onPress={handler} style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}>
```

Or use the project's existing Pressable patterns from other screens.

## Updates

### 2026-02-27
- Initial creation from codebase audit
