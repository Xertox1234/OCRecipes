---
title: "Single-screen wizard with Reanimated transitions"
track: knowledge
category: design-patterns
tags: [react-native, wizard, reanimated, multi-step-forms, navigation]
module: client
applies_to:
  ["client/components/recipe-wizard/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Single-screen wizard with Reanimated transitions

## When this applies

For multi-step forms (recipe creation, onboarding), use a single screen component with a `WizardShell` that manages step state internally. Steps are swapped via Reanimated layout animations using a `key` change — not separate navigation screens.

## Examples

```typescript
// WizardShell manages: currentStep, direction, validation, progress bar, nav buttons
const [currentStep, setCurrentStep] = useState<WizardStep>(1);
const [direction, setDirection] = useState<"forward" | "back">("forward");

// Step transitions via key change + entering/exiting animations
const entering = direction === "forward" ? SlideInRight.duration(250) : SlideInLeft.duration(250);
const exiting = direction === "forward" ? SlideOutLeft.duration(250) : SlideOutRight.duration(250);

<Animated.View key={`step-${currentStep}`} entering={entering} exiting={exiting}>
  {renderStep()}
</Animated.View>
```

### Architecture

```
Screen (thin wrapper — extracts route params, provides navigation callbacks)
└── WizardShell (manages step state, progress bar, nav buttons)
    ├── Step1Component (pure view + form interactions, receives props)
    ├── Step2Component
    └── ...
```

Each step component is a focused, pure-view component receiving only the data and callbacks it needs. No step component manages navigation or validation — that is centralized in the shell.

### Edit-from-preview pattern

The final step shows a preview with "Edit" links. Tapping one sets `returnToPreview = true` and jumps back to that step. On the next "Next" tap, `returnToPreview` causes a fast-forward back to Preview, skipping intermediate steps.

```typescript
const editFromPreview = useCallback((targetStep: WizardStep) => {
  setReturnToPreview(true);
  setDirection("back");
  setCurrentStep(targetStep);
}, []);

// In goNext:
if (returnToPreview) {
  setReturnToPreview(false);
  setCurrentStep(PREVIEW_STEP);
  return;
}
```

## Why

**Single-screen over navigation stack:**

- Progress bar and nav buttons stay persistent (no re-mount flicker)
- Step state is trivial (`useState` vs navigation params)
- Edit-from-preview jumps are simple state changes, not complex `navigation.navigate` calls
- No risk of stale params or navigation stack depth issues

## Exceptions

When to use: Multi-step forms with 4+ steps where the user fills data across steps and reviews at the end. Not needed for simple 2-3 step flows where separate screens work fine.

## Related Files

- `client/components/recipe-wizard/WizardShell.tsx`
- `client/screens/meal-plan/RecipeCreateScreen.tsx`

## See Also

- [Dirty state sync via ref callbacks](dirty-state-sync-ref-callbacks-2026-05-13.md)
- [Single owner of unsaved-changes prompt](../conventions/single-owner-unsaved-changes-prompt-2026-05-13.md)
