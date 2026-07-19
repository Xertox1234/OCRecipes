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

## Platform caveat (verified 2026-07-19, PR #668 review)

On iOS **Fabric** (this app: `newArchEnabled: true`), the wrapper's `radiogroup` role announces **nothing** — Fabric's role→VoiceOver mapping (`RCTViewComponentView.mm`, `accessibilityValue` getter) special-cases only `checkbox` and `radio`; the legacy Paper mapping that spoke "radio group" explicitly does not run on Fabric. Android is unaffected (`ReactAccessibilityDelegate.java` handles `RADIOGROUP` via `setRoleDescription`). Per-chip semantics still work on both platforms (each option announces "radio button, selected/not selected" from its own `radio` role + `selected` state), so the pattern remains the correct baseline — but do not expect an iOS "radio group" announcement from the wrapper, and don't rely on a wrapper `accessibilityLabel` being spoken unless the wrapper is itself an accessibility element. Codebase-wide follow-up: `todos/P3-2026-07-19-fabric-radiogroup-ios-voiceover-gap.md`.

## Exceptions

When to use:

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

## See Also

- [`role` prop for unsupported ARIA roles](../conventions/role-prop-for-unsupported-aria-roles-2026-05-13.md)
- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
