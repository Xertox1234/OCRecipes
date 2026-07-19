---
title: Switch role requires static label, not action phrase
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, switch, voiceover, talkback]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-07-19'
---

# Switch role requires static label, not action phrase

## Rule

When a control uses `accessibilityRole="switch"` together with `accessibilityState={{ checked }}`, the `accessibilityLabel` **must** be a static noun or short description of the element (e.g. "Flashlight", "Share to community") and **must not** be a dynamic imperative phrase that changes with the checked state (e.g. "Turn on flashlight" / "Turn off flashlight").

The switch role already tells assistive technology that the element can be toggled, and the `checked` state provides the current on/off value. Adding a dynamic action label creates a redundant, contradictory announcement — for example, the screen reader might say "Turn off flashlight, switch, on", which is confusing to the user.

## Examples

### Good (static label)

```typescript
// In RecipeGenerationModal.tsx
<Pressable
  accessibilityRole="switch"
  accessibilityState={{ checked: shareToPublic }}
  accessibilityLabel="Share to community"
  // ...
/>
```

```typescript
// In BeveragePickerSheet.tsx
<Pressable
  accessibilityRole="switch"
  accessibilityState={{ checked: isSelected }}
  accessibilityLabel={capitalize(mod)}
  // ...
/>
```

```typescript
// In ScanScreen.tsx (after fix)
<TouchableOpacity
  accessibilityRole="switch"
  accessibilityState={{ checked: torchEnabled }}
  accessibilityLabel="Flashlight"
  // ...
/>
```

### Bad (dynamic action phrase)

```typescript
// In ScanScreen.tsx (before fix – DO NOT DO THIS)
<TouchableOpacity
  accessibilityRole="switch"
  accessibilityState={{ checked: torchEnabled }}
  accessibilityLabel={
    torchEnabled ? "Turn off flashlight" : "Turn on flashlight"
  }
  // ...
/>
```

## Why

- The `accessibilityRole="switch"` already signals to the user that the element is a toggle.
- The `accessibilityState.checked` tells VoiceOver/TalkBack whether the switch is on or off.
- A dynamic action label duplicates that information and often contradicts the actual state (e.g. "Turn off flashlight" when the switch is currently on leads to the nonsensical announcement "Turn off flashlight, switch, on").
- A static label keeps the announcement clean: the user hears "Flashlight, switch, on" or "Flashlight, switch, off" – the verb is implicit in the switch role.
- This pattern is consistent with iOS and Android native conventions for toggles in settings rows.

## Exceptions

**When to use:** Any toggle switch where the label is a noun describing the feature being controlled (e.g. "Flashlight", "Dark mode", "Notifications").

**When NOT to use:** Standalone action buttons that are not switches (e.g. a "Save" button should use `accessibilityRole="button"` and a static label like "Save"). Also, do not apply this rule to controls that are not toggles with `checked` state.

## Related Files

- `client/screens/ScanScreen.tsx`
- `client/components/RecipeGenerationModal.tsx`
- `client/components/BeveragePickerSheet.tsx`
- `docs/solutions/design-patterns/switch-row-wrapped-pressable-full-row-accessibility-2026-05-13.md`

## See Also

- [Switch row wrapped in Pressable for full-row accessibility](../design-patterns/switch-row-wrapped-pressable-full-row-accessibility-2026-05-13.md) – companion pattern for layout, labeling, and focus management.