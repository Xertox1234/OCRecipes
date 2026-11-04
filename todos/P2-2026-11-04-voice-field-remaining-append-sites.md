---
title: "Voice input: move the five append-style mic fields onto useVoiceField"
status: backlog
priority: medium
created: 2026-11-04
updated: 2026-11-04
assignee:
labels: [deferred, client, voice]
github_issue:
---

# Voice input: move the five append-style mic fields onto useVoiceField

## Summary

Five screens keep their own "this field owns the mic" ref under another name (`voiceBaseRef` / `voiceTargetRef`). It is set when the user taps the mic and never cleared when the session ends on its own (silence timeout, error): the chat and notebook screens clear it only on submit or send, and the two wizard steps never clear it at all. So after a session times out, a later transcript from the shared recognizer can still be written into the old field — the same bug #1735 fixed for the `voiceActiveRef` sites.

## Background

#1735 (merged 2026-11-04, 817221669) added `client/hooks/useVoiceField.ts` and moved the nine `voiceActiveRef` sites onto it. Its todo listed these five as "check first, they use other names"; they were out of its file scope. Checked on main at 817221669: all five set the ref on mic start. `ChatScreen` (~609), `RecipeChatScreen` (~537) and `NotebookEntryScreen` (~198) clear it only on submit/send; `IngredientsStep` (~169) and `InstructionsStep` (~266) only ever assign it and never reset it. In all five the write effect still fires on `transcript && (isListening || isFinal)`.

## Acceptance Criteria

- [ ] `ChatScreen`, `RecipeChatScreen`, `NotebookEntryScreen`, `IngredientsStep`, `InstructionsStep` use `useVoiceField`; the base text (and, for the wizard steps, the target row key) is kept by the caller and applied inside `onTranscript`
- [ ] Ownership is cleared when the session ends for any reason, via the hook — no per-screen ownership ref left
- [ ] ChatScreen / RecipeChatScreen keep their "stop dictation when a reply starts streaming" behaviour
- [ ] Wizard steps: a step that is not visible passes `enabled: false`
- [ ] A test per screen kind (chat, notebook, wizard row) proves a transcript arriving after the session ended is not written

## Implementation Notes

- Files: `client/screens/ChatScreen.tsx`, `client/screens/RecipeChatScreen.tsx`, `client/screens/NotebookEntryScreen.tsx`, `client/components/recipe-wizard/IngredientsStep.tsx`, `client/components/recipe-wizard/InstructionsStep.tsx`, and their tests.
- `useVoiceField({ onTranscript, enabled })` returns `{ isListening, volume, error, toggle, release }`. Capture the base text in the mic handler before calling `toggle()`. Chat and notebook: call `release()` on submit/send. Wizard steps have no submit: rely on the hook clearing ownership when the session ends, pass `enabled: false` when the step is hidden, and call `release()` when the target row is removed.
- The hook may need a small extension only if a site cannot be expressed with `onTranscript` + caller-held base; prefer keeping the hook unchanged.

## Scope Contract

- **Mechanisms to use:** `client/hooks/useVoiceField.ts` (from #1735)
- **Files in scope:** the five files above, `client/hooks/useVoiceField.ts`, their tests
- No new mechanisms, files, or abstractions beyond those listed.

## Risks

- Phone check (simulator mic is unreliable): in chat and the recipe wizard, start dictation, let it time out, then type or dictate elsewhere — no stray text. Can be combined with the #1735 phone check.

## Updates

### 2026-11-04

- Filed by the /todo-fast run for #1735 (deferred warning from its executor, confirmed by reading the five sites on main).
