---
title: "OnboardingContext: wrap Provider value in useMemo, stabilize callbacks"
status: completed
priority: medium
created: 2026-05-10
updated: 2026-05-11
assignee:
labels: [performance, react-native]
github_issue:
---

# OnboardingContext: wrap Provider value in useMemo, stabilize callbacks

## Summary

`OnboardingContext.Provider` creates a new object literal every render with unstable callback references, causing all consumers to re-render on any state change in any screen during onboarding.

## Background

Audit 2026-05-10, finding M1. `client/context/OnboardingContext.tsx:94-108`. Every other context in the project (`BatchScanContext`, `ThemeContext`, `ToastContext`, `PremiumContext`) already uses `useMemo`. `OnboardingContext` is the lone outlier.

## Acceptance Criteria

- [x] All callbacks (`updateData`, `nextStep`, `prevStep`, `skipOnboarding`, `completeOnboarding`) wrapped in `useCallback`
- [x] Context value object wrapped in `useMemo` with callback deps
- [x] Existing onboarding flow functions correctly
- [x] While fixing: add `try-catch` to `completeOnboarding` and `skipOnboarding` (also deferred as M16)

## Implementation Notes

```typescript
const value = useMemo(
  () => ({ data, currentStep, updateData, nextStep, prevStep, skipOnboarding, completeOnboarding }),
  [data, currentStep, updateData, nextStep, prevStep, skipOnboarding, completeOnboarding],
);
return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
```

## Updates

### 2026-05-10

- Deferred from audit 2026-05-10 (M1) — correct but not urgent
- Can be combined with M16 (error handling) fix in same PR

### 2026-05-11

- Verified all acceptance criteria already satisfied on `main`:
  - `fd071866` "perf: memoize OnboardingProvider value and stabilize callbacks" (PR #123) — useMemo wrap + useCallback for all 5 callbacks (updateData, nextStep, prevStep, skipOnboarding, completeOnboarding)
  - `91a21200` and `8308538b` — try/catch error handling added to skipOnboarding and completeOnboarding (M16 scope)
- Current state of `client/context/OnboardingContext.tsx` matches the Implementation Notes pattern exactly (useMemo value with [data, currentStep, ...callbacks, isSubmitting] deps; useCallback on every action; try/catch + console.error in both async ops)
- No code changes required; archived as completed
