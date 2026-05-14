---
title: "Inline validation errors via InlineError component (not Alert.alert)"
track: knowledge
category: conventions
tags: [react-native, forms, validation, accessibility, alert]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
created: 2026-05-13
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

## Related Files

- `client/components/InlineError.tsx`

## See Also

- [Input error states with aria-invalid](input-error-states-with-aria-invalid-2026-05-13.md)
- [Error feedback: toast.error + haptics](../design-patterns/error-feedback-toast-error-haptics-2026-05-13.md)
