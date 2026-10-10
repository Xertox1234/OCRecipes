---
title: "A streamed chat turn dropped on `done` flashes the previous turn until the refetch lands — hand it over by saved-row ids in the same render"
track: bug
category: logic-errors
tags: [client-state, react-native, chat, streaming, optimistic-ui, react-query]
module: client
applies_to: ["client/components/coach/CoachChat.tsx", "client/screens/RecipeChatScreen.tsx", "client/components/coach/**/*.tsx"]
symptoms: ["when a reply finishes streaming, the previous reply (its chips, its Regenerate link) shows for a moment without the new question", "the question bubble shows twice while a reply regenerates", "the first message of a new chat shows twice until the reply finishes"]
created: 2026-10-10
severity: medium
---

# A streamed chat turn dropped on `done` flashes the previous turn

## Problem

A chat turn is on screen in two copies over its life: a **live copy** (the optimistic question plus
the streamed text) and the **saved copy** (rows from the messages query). On stream `done`, CoachChat
cleared the optimistic question, and `isStreaming` hid the streamed text, in the same moment. The
saved rows only arrived with the refetch. For that round trip the list showed the conversation as it
was before the question. (#1353)

Two duplicate bugs came from the same mistake, choosing which copy to show without looking at what the
saved list actually holds:

- **Regenerate** deleted the reply and the question on the server but dropped only the reply from the
  cache. The old question row sat next to the resent question's live copy for the whole turn.
- **A new conversation's** first messages fetch lands mid-reply, after the server saved the question,
  so the saved question and the live copy both showed.

## Root cause

The decision about which copy to show was keyed on **stream events** (`done`, `isStreaming`), not on
**what the saved list contains**. Those two signals are a network round trip apart.

## Fix

- Hold the live turn until the saved list contains a reply **newer than the last assistant id
  recorded at `done`**. Drop the live copy in the render that shows the saved one (a derived boolean
  such as `turnSaved`, not a later effect), so no frame shows neither copy and none shows both.
- If the refetch ends with nothing new saved (a refund or a failed fetch), clear the live copy then.
  Bump a **turn epoch** on every send so a late refetch can't clear a newer question.
- Gate everything that belongs to "the last reply" (Regenerate, active chips, retry) on
  `showLiveReply`, not `isStreaming`. Otherwise the previous reply grows those controls for the
  length of the save.
- Hide the optimistic question once the **last saved row is a user row newer than the newest row id
  at send time**. Compare ids, not text, so server-side cleaning of the content can't break the match.
  Also require that row to be last, so an unanswered question left by an earlier failed turn doesn't
  hide a new one.
- An optimistic cache edit must remove **every** row the server mutation deletes.

## Verifying it

Unit tests that mock `useChatMessages` cannot see the cache, and a final-state assertion hides an
in-between frame. Count copies inside `React.Profiler`'s `onRender` (once per commit) for "never both".

On the simulator, the gap on a local server is about one frame, so a clean recording proves nothing.
Delay the messages GET by about 450ms (local only, never committed), record with
`xcrun simctl io <UDID> recordVideo`, and diff frames. On the old code the pre-turn state then lasts
about 15 frames, which gives the "after" recording something to disprove. Record the old code
first, in the same setup.

Related: [pending → saved remount resets card state](pending-to-saved-remount-resets-inline-card-state-2026-10-09.md).
