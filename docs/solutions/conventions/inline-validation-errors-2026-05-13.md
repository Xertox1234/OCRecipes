---
title: Inline validation errors via InlineError component (not Alert.alert)
track: knowledge
category: conventions
module: client
tags: [react-native, forms, validation, accessibility, alert]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-07-05'
---

# Inline validation errors via InlineError component (not Alert.alert)

## Rule

Use the shared `<InlineError>` component for form validation instead of `Alert.alert()`. Inline errors are visible alongside the input, accessible via `accessibilityRole="alert"`, and don't block interaction like `Alert.alert()` does.

## Examples

```typescript
import { InlineError } from "@/components/InlineError";

const [error, setError] = useState<string | null>(null);

// Validate on submit
const handleSubmit = () => {
  if (isNaN(value) || value <= 0) {
    setError("Please enter a valid value.");
    return;
  }
  setError(null);
  // proceed...
};

// Clear error on input change
<TextInput onChangeText={(text) => {
  setValue(text);
  if (error) setError(null);
}} />

// Render after input
<InlineError message={error} style={{ marginTop: Spacing.sm }} />
```

## Why

Inline errors are visible alongside the input, accessible via `accessibilityRole="alert"`, and don't block interaction like `Alert.alert()` does. Alert dialogs interrupt the user's flow and force a tap-to-dismiss; inline errors stay visible while the user corrects the input.

## Exceptions

A native `Alert.alert()` is the right tool — not a violation of this rule — for a **blocking system decision that requires an action button**, as opposed to in-flow error text tied to an input. Two structural differences distinguish this from the form-validation case the rule targets:

- `InlineError` renders message-only text; it has no slot for an action button. A permission-denied prompt (Cancel vs. "Open Settings", which navigates the user out of the app) has no in-flow home to render into.
- `accessibilityLiveRegion`/`accessibilityRole="alert"` (what `InlineError` wires up) doesn't even apply to a native `Alert.alert()` dialog — it's rendered outside the RN view tree (`UIAlertController` / Android `AlertDialog`), and VoiceOver/TalkBack announce it and its buttons automatically.

Examples: camera/photo-library permission-denied → "Open Settings" (see the runtime-errors solution linked below), destructive-action confirmations. Do **not** extend this exception to in-flow validation or load-failure text that has a natural place to render next to the field or content it describes — that case stays on `InlineError`.

## Related Files

- `client/components/InlineError.tsx`
- `client/components/meal-plan/ImportRecipeSheet.tsx` — permission-denied `Alert.alert()` exception

## See Also

- [Input error states with aria-invalid](input-error-states-with-aria-invalid-2026-05-13.md)
- [Error feedback: toast.error + haptics](../design-patterns/error-feedback-toast-error-haptics-2026-05-13.md)
- [expo-image-picker: Android rejects the launcher on permission denial](../runtime-errors/imagepicker-android-permission-reject-guard-recheck-2026-07-05.md) — the permission-denied Alert.alert() case this exception covers
