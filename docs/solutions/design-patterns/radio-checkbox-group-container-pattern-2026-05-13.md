---
title: Radio/checkbox group container pattern
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, radio, checkbox, role, group]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-19'
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

## Platform caveat (verified 2026-07-19, PR #668 review; decision recorded 2026-07-19)

On iOS **Fabric** (this app: `newArchEnabled: true`), the wrapper's `radiogroup` role announces **nothing** — Fabric's role→VoiceOver mapping (`RCTViewComponentView.mm`, `accessibilityValue` getter) special-cases only `checkbox` and `radio`; the legacy Paper mapping that spoke "radio group" explicitly does not run on Fabric. Android is unaffected (`ReactAccessibilityDelegate.java` handles `RADIOGROUP` via `setRoleDescription`). Fabric drops the wrapper announcement for other ARIA group roles the same way (e.g. `tablist`) — this is a class of gap, not a `radiogroup`-only bug.

Per-chip semantics still work on both platforms (each option announces "radio button" — VoiceOver's spoken text for the `radio` role via `accessibilityValue`, which is `RCTLocalizedString`'s default value `@"" string`, i.e. the literal string `"radio button"`, NOT the longer "a checkable input... only one of which can be checked at a time" text, which is only the translator-context argument baked into the localization key and is never spoken — plus the Selected trait when `accessibilityState.selected` is true; RN's own source comment explains only that screen-reader users are assumed already familiar with radio/checkbox controls from using the web, which is why RN announces the control name at all — the single-select-from-affordance inference below is this doc's reasoning, not RN's), so the pattern remains the correct baseline. **Decision: accept-and-document, not mitigate.** A supplemental iOS-only grouping cue (e.g. a positional "x of y" per chip) can't be verified without a live VoiceOver device pass and risks double-announcing against the group's own container navigation. Keep using the `radiogroup`/group-role wrapper for structure, Android correctness, and forward-compat with a future RN Fabric fix — don't add per-screen compensating cues for the iOS gap. Codified in `docs/rules/accessibility.md`.

## Exceptions

When to use:

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

## See Also

- [`role` prop for unsupported ARIA roles](../conventions/role-prop-for-unsupported-aria-roles-2026-05-13.md)
- [Accessibility props pattern](accessibility-props-pattern-2026-05-13.md)
