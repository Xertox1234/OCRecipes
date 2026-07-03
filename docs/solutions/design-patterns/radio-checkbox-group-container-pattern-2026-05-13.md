---
title: Radio/checkbox group container pattern
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, radio, checkbox, role, group]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Radio/checkbox group container pattern

## When this applies

When rendering lists of radio buttons or checkboxes, wrap them in a container with the appropriate group role. Screen readers use `radiogroup` to understand that only one option can be selected.

## Examples

```typescript
// Good: Radio group with accessibilityRole
<View accessibilityRole="radiogroup">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => setSelected(option.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === option.id }}
    >
      {/* Radio button content */}
    </Pressable>
  ))}
</View>

// Good: Checkbox group (no special container role needed, but can use "list")
<View accessibilityRole="list">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => toggleOption(option.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selectedIds.includes(option.id) }}
    >
      {/* Checkbox content */}
    </Pressable>
  ))}
</View>
```

## Why

Screen readers use the `radiogroup` role to understand that only one option can be selected. This provides proper context and navigation behavior for assistive technology users.

## Exceptions

When to use:

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

## See Also

- [`role` prop for unsupported ARIA roles](../conventions/role-prop-for-unsupported-aria-roles-2026-05-13.md)
- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
