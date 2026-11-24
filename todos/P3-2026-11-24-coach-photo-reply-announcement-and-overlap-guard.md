---
title: "Coach photo turn: announce the reply to screen readers; refuse overlapping turns on the server"
status: backlog
priority: low
created: 2026-11-24
updated: 2026-11-24
assignee:
labels: [deferred, coach, accessibility]
github_issue:
blocked_reason: "The first step is a VoiceOver check on a simulator or device, and a decision to close an item that does not reproduce"
human_led: true
---

# Coach photo turn: announce the reply to screen readers; refuse overlapping turns on the server

## Summary

Two small follow-ups to the Coach camera button (roadmap S1, PR #1984): a
screen-reader user hears "Looking at your photo" but nothing when the reply
arrives, and only the app stops a photo turn from overlapping another turn in
the same conversation.

## Background

Both were noticed during the S1 review and left out of that PR to keep it
small. Neither loses data. They were found by reading the code, not by a
device run with VoiceOver or by sending two requests at once, so the first step
is to confirm each one.

1. `client/components/coach/CoachChat.tsx` announces "Looking at your photo"
   in the photo send's `onStart`. Its `onSettled` refetches the messages and
   announces nothing. A typed turn announces its finish through
   `getStreamFinishAnnouncement`; the photo path has no stream, so that effect
   never runs for it.
2. `client/hooks/useCoachPhotoSend.ts` (`disabled`, `canStart`) keeps a photo
   from starting during a typed turn. `server/routes/chat-photo.ts` has no
   matching check, so a second client, a retry or a direct API call can run two
   turns in one conversation at once and interleave their messages.

## Acceptance Criteria

- [ ] Each item is confirmed first (VoiceOver on a simulator or device for 1; two concurrent requests against a local server for 2). An item that does not reproduce is closed with a note, not built.
- [ ] When a photo turn's reply arrives, a screen reader announces it (the reply's text or a short "Coach replied" line), and a failed turn announces its error once.
- [ ] The announcement is not spoken on top of "Looking at your photo".
- [ ] A photo turn sent while another turn is running in the same conversation gets a clear refusal (409) and stores nothing, or the item is closed with the reason the server does not need it.
- [ ] Tests cover both behaviours.

## Implementation Notes

- Reuse the existing announcement helpers in `client/components/coach/` (`getStreamFinishAnnouncement`, `announcedOffset`); put any new decision logic in a `*-utils.ts` file so Vitest covers it.
- The typed route (`server/routes/chat.ts`) appears to have no overlap guard either. If a guard is added, put it where both routes use it rather than in the photo route alone.

## Scope Contract

- **Mechanisms to use:** the existing accessibility announcement helpers; a per-conversation in-flight check shared by both chat routes.
- **Files in scope:** `client/components/coach/CoachChat.tsx`, `client/components/coach/coach-photo-utils.ts`, `client/hooks/useCoachPhotoSend.ts`, `server/routes/chat-photo.ts`, `server/routes/chat.ts`, `server/services/coach-photo.ts`, and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A server guard held in memory does not cover more than one server instance.
- A guard that is not released on every exit path would lock a conversation.

## Updates

### 2026-11-24

- Initial creation
