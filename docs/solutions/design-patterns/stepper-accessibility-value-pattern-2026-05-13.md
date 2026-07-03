---
title: Stepper +/− button accessibilityValue pattern
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, stepper, voiceover, talkback]
applies_to: [client/components/**/*.tsx]
created: '2026-05-13'
---

# Stepper +/− button accessibilityValue pattern

## When this applies

Numeric steppers (+/− Pressable pair) should carry `accessibilityValue` on each button so VoiceOver announces the current value after activation. The decorative number text in between should be hidden from the accessibility tree to prevent double-announcement.

## Examples

```typescript
import { MIN_SERVINGS, MAX_SERVINGS } from "./step-utils";

<Pressable
  onPress={() => handleChange(-1)}
  disabled={atMin}
  accessibilityRole="button"
  accessibilityLabel="Decrease servings"
  accessibilityValue={{
    now: servings,
    min: MIN_SERVINGS,
    max: MAX_SERVINGS,
    text: `${servings} servings`,
  }}
>
  <Feather name="minus" ... />
</Pressable>

{/* Hide from VoiceOver — value is on the buttons */}
<Text
  accessibilityElementsHidden
  importantForAccessibility="no"
>
  {servings}
</Text>

<Pressable
  onPress={() => handleChange(1)}
  accessibilityRole="button"
  accessibilityLabel="Increase servings"
  accessibilityValue={{ now: servings, min: MIN_SERVINGS, max: MAX_SERVINGS, text: `${servings} servings` }}
>
  <Feather name="plus" ... />
</Pressable>
```

## Why

`accessibilityElementsHidden` + `importantForAccessibility="no"` are the correct cross-platform RN props for hiding decorative elements from the accessibility tree. `accessibilityElementsHidden` covers iOS VoiceOver; `importantForAccessibility="no"` covers Android TalkBack. Do NOT use `aria-hidden` — it is a web HTML attribute and is silently ignored in React Native.

## Related Files

- `client/components/recipe-wizard/TimeServingsStep.tsx`
