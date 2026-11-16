---
title: A scroll view that holds a text field and tappable controls needs keyboardShouldPersistTaps="handled", or the first tap after typing does nothing
track: knowledge
category: conventions
tags: [react-native, forms, keyboard, scroll-view]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-11-16
---

# A scroll view that holds a text field and tappable controls needs keyboardShouldPersistTaps="handled"

## Rule

When a `ScrollView` (or `KeyboardAwareScrollViewCompat`) contains a text input and anything else the user taps (chips, a picker, a Save button), set `keyboardShouldPersistTaps="handled"` on it.

## Smell patterns

- A form where the user types a name and then taps a chip, and the chip needs two taps.
- A screen test that types and then presses a control passes, while the same steps in the simulator need the control tapped twice.

## Why

The default is `"never"`: while a text input has focus, the first tap anywhere in the scroll view only dismisses the keyboard and is not delivered to the control under it. In the family profile form the user types a name and then taps an allergy; the first tap on the allergy was swallowed. jsdom has no keyboard, so tests cannot see it.

`"handled"` delivers the tap to a control that handles it, and still dismisses the keyboard for a tap on empty space.

## Examples

```tsx
<KeyboardAwareScrollViewCompat keyboardShouldPersistTaps="handled">
  <TextInput label="Name" ... />
  <AllergenPicker ... />
  <Button onPress={handleSave}>Save</Button>
</KeyboardAwareScrollViewCompat>
```

## Exceptions

A scroll view whose only interactive content is the text input itself.

## Related Files

- `client/screens/FamilyProfileEditScreen.tsx`
- `client/screens/QuickLogScreen.tsx`, `client/screens/GoalSetupScreen.tsx` — earlier screens that already set it

## See Also

- [a sheet's fixed height hides its buttons](../logic-errors/bottom-sheet-fixed-height-cuts-off-its-buttons-when-content-grows-2026-11-16.md) — another defect only the simulator shows
