---
title: "Accessibility gaps from 2026-04-26 audit"
status: in-progress
priority: medium
created: 2026-04-26
updated: 2026-04-26
labels: [accessibility, react-native, audit-2026-04-26]
audit_ids: [M12, M13, M14, L29]
---

# Accessibility gaps from 2026-04-26 audit

## Summary

Four accessibility issues in recently modified components. H1 (remix badge silent to screen readers) and M15 (touch target) were fixed in the 2026-04-26 fix pass. These four remain.

## Findings (cross-ref `docs/audits/2026-04-26-full.md`)

- **M12** — `FallbackImage` in `HomeRecipeCard` has both `accessible={false}` and `accessibilityLabel`. The two props are mutually exclusive — `accessible={false}` removes the element from the a11y tree entirely, making the label unreachable. The label is also redundant since the parent card already conveys the recipe name. Fix: remove the `accessibilityLabel` from the image (leave `accessible={false}` intact). `client/components/HomeRecipeCard.tsx:70–71`
- **M13** — Allergen dot `View` has `accessibilityRole="text"`, which is not a valid React Native role (web ARIA only). On Android, TalkBack may behave unexpectedly. Additionally the parent card's `accessibilityLabel` already includes the allergen warning, so the dot independently announces it a second time on TalkBack. Fix: add `accessible={false}` to the allergen dot View and remove the invalid `accessibilityRole`. `client/components/HomeRecipeCard.tsx:88–102`
- **M14** — `RecipeGenerationModal` error announcement: the `useEffect` that calls `AccessibilityInfo.announceForAccessibility` on iOS has `[generateMutation.isError]` as its dep. If `isError` stays `true` across two failed attempts (different error messages), the effect does not re-fire and the second error is silently swallowed. Fix: add `generateMutation.error` to the dep array so re-announcement fires on each new error. `client/components/RecipeGenerationModal.tsx:104–113`
- **L29** — `TextInput` component silently replaces the caller-supplied `accessibilityHint` with the error message text when `error && errorMessage` is true. Error state is already communicated via `aria-invalid`; the hint should be preserved or appended (e.g., `${props.accessibilityHint ? props.accessibilityHint + '. ' : ''}${errorMessage}`). `client/components/TextInput.tsx:90–93`

## Acceptance Criteria

- [ ] `FallbackImage` in `HomeRecipeCard` no longer has a redundant `accessibilityLabel` when `accessible={false}`
- [ ] Allergen dot has `accessible={false}` and no `accessibilityRole="text"` — no double-announcement on TalkBack
- [ ] Error re-announcement fires on each distinct error in `RecipeGenerationModal` (dep includes `generateMutation.error`)
- [ ] `TextInput` preserves or appends caller-supplied `accessibilityHint` instead of replacing it
- [ ] Existing tests pass

## Implementation Notes

- M12 and M13 are both in `HomeRecipeCard.tsx` — fix in one PR.
- M14 is a one-line dep array change in `RecipeGenerationModal.tsx`.
- L29 in `TextInput.tsx` — test by passing both `error + errorMessage` and `accessibilityHint` simultaneously and verifying TalkBack/VoiceOver reads both.
