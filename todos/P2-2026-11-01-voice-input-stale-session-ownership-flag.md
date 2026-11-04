---
title: "Voice input: the 'this field owns the mic' flag stays set after the session ends"
status: backlog
priority: medium
created: 2026-11-01
updated: 2026-11-01
assignee:
labels: [deferred, client, voice]
github_issue:
---

# Voice input: the "this field owns the mic" flag stays set after the session ends

## Summary

Each voice-enabled screen keeps a `voiceActiveRef` that says "the transcript belongs to this field". It is set when the user taps the mic but is only cleared on some paths, so after a session ends on its own (silence timeout, error) a later transcript can still be written into the old field. In `GenerateRecipeDrawer`, closing the drawer mid-session does not stop the recognizer or clear the flag.

## Background

Found by the final review of #1668 (voice input on typing screens, merged 2026-11-01). The owner approved merging with this as a follow-up. The same flag pattern was copied to every screen that got a mic.

## Acceptance Criteria

- [ ] The flag is cleared when the speech session ends for any reason (final result, silence, error, cancel) — an effect that runs after the transcript-write effect
- [ ] Closing `GenerateRecipeDrawer` (and `RecipeSearchDrawer`) while listening stops the recognizer and clears the flag
- [ ] Applied the same way at every site below; ideally the flag moves into one shared hook so the sites can't drift
- [ ] A test proves a transcript that arrives after the session ended is not written into the field

## Implementation Notes

Sites using `voiceActiveRef` on main at 3a07881c (`grep -rln voiceActiveRef client`):

- `client/components/home/GenerateRecipeDrawer.tsx` (lines ~55–75)
- `client/components/home/RecipeSearchDrawer.tsx`
- `client/components/BeveragePickerSheet.tsx`
- `client/components/meal-plan/QuickAddSheet.tsx`
- `client/components/recipe-wizard/TitleStep.tsx`
- `client/screens/meal-plan/GroceryListScreen.tsx`
- `client/screens/meal-plan/PantryScreen.tsx`
- `client/screens/meal-plan/RecipeAIGenerateScreen.tsx`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx`

The #1668 review also named ChatScreen, RecipeChatScreen, NotebookEntry, IngredientsStep and InstructionsStep. They don't use the `voiceActiveRef` name, so check whether they hold the same flag under another name before changing them.

## Scope Contract

- **Mechanisms to use:** the existing speech-recognition hook; a small shared helper hook is allowed if it replaces the copied ref logic
- **Files in scope:** the files listed above, the speech hook in `client/hooks/`, and their tests
- No new mechanisms beyond those listed.

## Dependencies

- None

## Risks

- Needs a phone check (the simulator's mic is unreliable): start dictation, let it time out, then type — no stray text should appear.

## Updates

### 2026-11-01

- Filed by the /todo run (from the #1668 final review).
