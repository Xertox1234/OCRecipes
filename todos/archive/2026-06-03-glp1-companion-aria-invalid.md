---
title: "Add aria-invalid to GLP1CompanionScreen dosage input on validation error"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, accessibility]
github_issue:
---

# Add aria-invalid to GLP1CompanionScreen dosage input on validation error

## Summary

`GLP1CompanionScreen` dosage `TextInput` and medication selector lack `aria-invalid={true}` when `validationError` is set. `InlineError` announces the message but the input has no machine-readable invalid state (WCAG 4.1.2).

## Background

Deferred from 2026-06-03 full audit (M10). Confirmed by researcher: RN 0.81 supports `aria-invalid` on `TextInput` (available since 0.73+). File: `client/screens/GLP1CompanionScreen.tsx:424-476,550-566`.

## Acceptance Criteria

- [ ] Dosage `TextInput` has `aria-invalid={!!validationError}` when a dosage error is set
- [ ] Medication selector has `aria-invalid={!!validationError}` when a medication error is set
- [ ] Assistive tech users can programmatically detect the invalid input state

## Implementation Notes

Use `aria-invalid` prop (not `accessibilityState={{ invalid: true }}` — `invalid` is not in `AccessibilityState` type). Pattern matches existing usage across the codebase (search for `aria-invalid`).

## Dependencies

- None

## Risks

- Low — prop addition only; no behavior change

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M10)
