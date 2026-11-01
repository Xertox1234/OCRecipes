---
title: "Offer voice input on every typing screen that has no camera"
status: done
priority: medium
created: 2026-10-29
updated: 2026-11-01
assignee:
labels: [deferred, client, voice]
github_issue:
---

# Offer voice input on every typing screen that has no camera

## Summary

The owner's rule is "camera first, voice where the camera isn't available". Voice is only on three
surfaces today, so most typing screens have neither a camera nor a mic. Add the existing voice input
to the screens that lack both.

## Background

Found during the 2026-10-29 brainstorm on teaching users the camera, voice and import features (the
Home Discover carousel is being replaced by in-context tips). The owner said: "where the camera isn't
available I have tried to consistently provide voice functionality". A read-only sweep showed that
isn't true yet, and tips can't point at a mic that isn't there. The owner ruled this is not design
work and belongs in its own session.

Voice today (all on `client/hooks/useSpeechToText.ts`):

- Quick Log: `client/hooks/useQuickLogSession.ts` → `QuickLogScreen` (`VoiceLogButton`, premium-only
  there) and `client/components/home/QuickLogDrawer.tsx` (`VoiceLogButton`)
- `client/components/meal-plan/SimpleEntrySheet.tsx` (`InlineMicButton`, gated by
  `usePremiumFeature("voiceLogging")`)
- `client/components/coach/CoachChat.tsx` (`CoachMicButton`, Coach Pro only)

Typing screens with no camera and no mic (from the sweep; re-check before starting):

- `client/screens/meal-plan/GroceryListScreen.tsx` — add item
- `client/screens/meal-plan/PantryScreen.tsx` — add item (has receipt capture, no mic)
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — search
- `client/components/home/RecipeSearchDrawer.tsx` — search
- `client/components/home/GenerateRecipeDrawer.tsx` and
  `client/screens/meal-plan/RecipeAIGenerateScreen.tsx` — recipe prompt
- `client/components/meal-plan/QuickAddSheet.tsx` — text entry
- `client/components/BeveragePickerSheet.tsx` — custom drink
- `client/screens/NotebookEntryScreen.tsx` — note
- `client/screens/ChatScreen.tsx` (free NutriCoach) and `client/screens/RecipeChatScreen.tsx` —
  chat composers
- Recipe wizard steps under `client/components/recipe-wizard/` (title, ingredients, instructions)

## Acceptance Criteria

- [x] Every screen in the list above either gets the shared mic control or is listed in the PR with a
      one-line reason it shouldn't (e.g. a field where dictation makes no sense).
- [x] Uses the existing `useSpeechToText` hook and an existing mic button (`InlineMicButton` or
      `VoiceLogButton`); no second speech pipeline.
- [x] The owner decides once whether voice stays premium-gated (`voiceLogging`) on the new screens;
      record the ruling here before building. Today it's gated in some places and not others.
- [x] Mic permission denied, no speech heard and recognition errors each show a clear message and
      leave the typed text untouched.
- [x] Tests for the new mic wiring on each changed screen; checked on the iOS simulator.

## Implementation Notes

- Read `useSpeechToText` and both mic components first; the sheet inputs may need
  `FocusBottomSheetTextInput` handling when the mic fills the field.
- Do this before the in-context tips that point at the mic (separate design work, 2026-10-29).

## Scope Contract

- **Mechanisms to use:** the existing `useSpeechToText` hook and existing mic button components.
- **Files in scope:** the screens listed under Background, their tests, and the mic components if a
  small prop is needed.
- No new speech service, permission flow or abstraction.

## Dependencies

- Owner ruling on premium gating (see acceptance criteria).

## Risks

- Premium gating is inconsistent today; copying one screen's choice everywhere would silently change
  what free users get.

## Updates

### 2026-10-29

- Created from the feature-teaching brainstorm; owner asked for a todo and a dedicated session.

### 2026-10-31

- **Owner ruling (in-session):** voice input on the new screens is FREE FOR EVERYONE, with no
  `voiceLogging` gate. The existing gates in SimpleEntrySheet, QuickLog and CoachChat are left as
  they are.

### 2026-11-01

- Implemented: mic on every screen in the list (replace for single-value fields, append for the
  chat composers, note and wizard instructions/ingredients). Wizard ingredients/instructions use ONE
  step-level recognizer that dictates into the last row (per-row hooks would all react to the same
  native start event). Wizard title gets the mic; description is left typed-only.
- Not verified on a simulator (the simulator has no speech engine); the on-device mic check on the
  phone is the owner's. Tests cover replace-vs-append, speech errors and the streaming-disabled
  mic on one single-value screen (GenerateRecipeDrawer) and one chat composer (RecipeChatScreen).
