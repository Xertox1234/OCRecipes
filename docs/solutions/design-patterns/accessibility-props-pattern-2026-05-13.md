---
title: 'Accessibility props pattern: labels, roles, states, hints, decorative icons'
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, voiceover, talkback, wcag, a11y]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Accessibility props pattern: labels, roles, states, hints, decorative icons

## When this applies

Provide semantic accessibility information for screen readers (VoiceOver on iOS, TalkBack on Android). This is essential for WCAG 2.1 Level AA compliance.

## Examples

### Core accessibility props

```typescript
// accessibilityLabel: Descriptive text read by screen readers
// accessibilityRole: Semantic role (button, checkbox, radio, text, header, etc.)
// accessibilityState: Current state (selected, checked, disabled, expanded)
// accessibilityHint: Optional hint about what happens when activated

<Pressable
  accessibilityLabel="Add to favorites"
  accessibilityRole="button"
  accessibilityHint="Saves this item to your favorites list"
  onPress={handleAddToFavorites}
>
  <Feather name="heart" size={24} />
</Pressable>
```

### Checkbox pattern (multi-select lists)

Use for lists where users can select multiple items (allergies, health conditions):

```typescript
// Good: Combines title and description for context
<Pressable
  onPress={() => toggleSelection(item.id)}
  accessibilityLabel={`${item.name}: ${item.description}`}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedIds.includes(item.id) }}
>
  <Text>{item.name}</Text>
  <Text>{item.description}</Text>
  <Feather name={isSelected ? "check-square" : "square"} />
</Pressable>
```

Why combine title and description: Screen reader users hear the full context in one announcement, rather than having to navigate to separate elements.

### Radio pattern (single-select lists)

```typescript
// Good: Uses radio role with selected state
<Pressable
  onPress={() => setSelectedOption(option.id)}
  accessibilityLabel={`${option.name}: ${option.description}`}
  accessibilityRole="radio"
  accessibilityState={{ selected: selectedOption === option.id }}
>
  <Text>{option.name}</Text>
  <Text>{option.description}</Text>
  <View style={[styles.radioOuter, isSelected && styles.radioSelected]}>
    {isSelected && <View style={styles.radioInner} />}
  </View>
</Pressable>
```

Difference from checkbox: Use `accessibilityRole="radio"` with `selected` state (not `checked`). This tells screen readers the selection is mutually exclusive.

### Icon-only button pattern

```typescript
// Good: Descriptive label for icon button
<Pressable
  onPress={() => navigation.goBack()}
  accessibilityLabel="Go back"
  accessibilityRole="button"
>
  <Feather name="arrow-left" size={24} color={colors.text} />
</Pressable>

// Good: Toggle button with state-aware label
<Pressable
  onPress={() => setTorch(!torch)}
  accessibilityLabel={torch ? "Turn off flashlight" : "Turn on flashlight"}
  accessibilityRole="button"
  accessibilityState={{ checked: torch }}
>
  <Feather name={torch ? "zap" : "zap-off"} size={24} />
</Pressable>
```

Why state-aware labels: Users know both the current state AND what will happen when they activate the button.

### Password visibility toggle pattern

```typescript
<Pressable
  onPress={() => setShowPassword(!showPassword)}
  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
  accessibilityRole="button"
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
>
  <Feather name={showPassword ? "eye-off" : "eye"} size={20} />
</Pressable>
```

### Decorative icons inside interactive elements

Icons inside a `Pressable` or `TouchableOpacity` that serve only as visual decoration (leading icons, trailing chevrons, status indicators) must be marked `accessible={false}`. Without this, VoiceOver on iOS announces each icon as a separate focusable element, forcing users to swipe through redundant items.

```typescript
// Good: Decorative icons hidden from screen readers
<Pressable
  onPress={handlePress}
  accessibilityLabel="GLP-1 Companion"
  accessibilityRole="button"
>
  <Feather name="activity" size={20} color={theme.text} accessible={false} />
  <ThemedText>GLP-1 Companion</ThemedText>
  <Feather name="chevron-right" size={16} color={theme.textSecondary} accessible={false} />
</Pressable>

// Bad: Icons are focusable — VoiceOver announces each separately
<Pressable onPress={handlePress} accessibilityLabel="GLP-1 Companion">
  <Feather name="activity" size={20} color={theme.text} />
  <ThemedText>GLP-1 Companion</ThemedText>
  <Feather name="chevron-right" size={16} color={theme.textSecondary} />
</Pressable>
```

When to mark `accessible={false}`:

- Leading icons in settings rows, list items, action rows
- Trailing chevrons or arrow indicators
- Lock badge icons (the parent `Pressable` already has the accessibility label)
- Status icons next to text that already describes the status
- Emoji or decorative `Image` components inside labeled containers

When NOT to mark `accessible={false}`:

- Icon-only buttons with no visible text (these need `accessibilityLabel` instead)
- Icons that convey information not present in the text label (e.g., an error icon when the label doesn't mention the error)

### Text input pattern

```typescript
<TextInput
  value={username}
  onChangeText={setUsername}
  placeholder="Username"
  accessibilityLabel="Username"
  accessibilityHint="Enter your username to sign in"
  autoCapitalize="none"
  autoCorrect={false}
/>
```

When to add `accessibilityHint`: when the purpose isn't obvious from the label alone, or when there are specific requirements (format, length, etc.).

### List item navigation pattern

```typescript
// Good: Comprehensive label with action hint
const HistoryItem = React.memo(function HistoryItem({
  item,
  onPress,
}: HistoryItemProps) {
  const calorieText = item.calories ? `${item.calories} calories` : "Calories unknown";

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
      accessibilityRole="button"
    >
      <Text>{item.productName}</Text>
      <Text>{item.brandName}</Text>
      <Text>{item.calories} cal</Text>
    </Pressable>
  );
});
```

Why include "Tap to view details": Informs users that activation will navigate somewhere, not perform an immediate action.

## References

- `client/screens/ProfileScreen.tsx` (SettingsItem), `client/components/home/ActionRow.tsx`, `client/components/HistoryItemActions.tsx`, `client/components/EmptyState.tsx`, `client/components/Toast.tsx`

## See Also

- [Parent label prefix for decorative children](../conventions/parent-label-prefix-decorative-children-2026-05-13.md)
- [Touch target size pattern](touch-target-size-pattern-2026-05-13.md)
- [Accessibility grouping pattern](accessibility-grouping-pattern-2026-05-13.md)
- [Radio/checkbox group container pattern](radio-checkbox-group-container-pattern-2026-05-13.md)
