---
title: "AI Coach and GLP-1 medical disclaimer"
status: in-progress
priority: high
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [compliance, legal, ai-safety, deferred]
github_issue:
---

# AI Coach and GLP-1 Medical Disclaimer

## Summary

Add a persistent medical disclaimer in the AI Coach screen and on the GLP-1 medication mode screen, stating that the app does not provide medical advice and is not a substitute for a healthcare professional.

## Background

The FTC and Health Canada both require that consumer health apps which use AI to provide personalized nutrition or health guidance include a clear disclaimer that the content is not medical advice. This is especially important for OCRecipes because: (1) the AI Coach responds to health condition inputs, (2) a GLP-1 medication mode exists that references prescription drugs, and (3) the dangerous dietary advice filter implies the app is making health-impacting decisions. Without a disclaimer, the app is at regulatory and liability risk. Apple also flags apps that imply medical diagnosis or treatment capability without a disclaimer.

## Acceptance Criteria

- [ ] A disclaimer banner appears at the top of the `CoachChat` screen on first open (dismissible, stored in AsyncStorage so it doesn't reappear every session)
- [ ] Disclaimer text: "OCRecipes provides general nutrition information, not medical advice. Always consult a qualified healthcare professional before making changes to your diet or medication."
- [ ] The GLP-1 mode toggle screen (or the onboarding GLP-1 step) shows a non-dismissible one-line note: "Consult your prescribing physician before adjusting your diet while on GLP-1 medication."
- [ ] Both disclaimers use the theme's secondary/muted text color, not a warning color (informational, not alarming)
- [ ] Disclaimer banner in Coach is accessible (screen reader announces it before the message list)
- [ ] AsyncStorage key: `@ocrecipes/coach_disclaimer_dismissed` (boolean)

## Implementation Notes

- Read `docs/patterns/react-native.md` MUST CHECK section before writing JSX
- `CoachChat` screen: `client/screens/CoachChatScreen.tsx` (or similar — confirm path)
- GLP-1 location: find the onboarding screen that renders the GLP-1 toggle and add the inline note there; also add to `EditDietaryProfile` modal if GLP-1 is editable there
- Use `useTheme()` for colors; `theme.colors.textSecondary` or equivalent
- The banner should not shift layout — use a collapsible or fixed-height approach to avoid CLS-like jank on dismiss
- Eligible for Copilot delegation (pure UI, no auth/health-data logic)

## Dependencies

- Identify exact file paths for CoachChat screen and GLP-1 onboarding step before implementing

## Risks

- Over-aggressive disclaimers can erode user trust — keep copy concise and factual
- If the GLP-1 screen is part of onboarding (not a standalone modal), inserting text there may affect layout of other onboarding screens

## Updates

### 2026-05-10

- Created from compliance review (North America launch planning)
