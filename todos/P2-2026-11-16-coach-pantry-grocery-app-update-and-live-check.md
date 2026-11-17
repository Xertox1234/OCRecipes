---
title: "Coach pantry and grocery tools: app update, then a live check on the phone"
status: blocked
priority: medium
created: 2026-11-16
updated: 2026-11-16
assignee:
labels: [deferred, ai-prompting, react-native]
github_issue:
human_led: true
blocked_reason: "Needs the owner: publishing an app update and spending on live model calls are both owner-only decisions"
---

# Coach pantry and grocery tools: app update, then a live check on the phone

## Summary

The pantry card and the new disclosure line are in the app bundle and reach phones only with
an app update. No real conversation with Coach has been run for any of the 2026-11-16 changes
(PRs 1892, 1894, 1895, 1897). Publish the update when the owner asks, then try the tools for
real.

## Background

- The server offers `update_pantry` only when the app sends `cardKinds: ["pantry"]`, so the
  server half does nothing until a build with the card is on the phone.
- The tests cover the logic. They do not show whether the model calls the tools at the right
  moments, or whether its reply matches what the card shows.
- Live model calls cost money; paid model checks are parked until the owner says otherwise.
- The production server answered its health check on 2026-11-16, but that endpoint does not
  say which commit is running. The privacy page on ocrecipes.com did show the new sentence
  that day, so the deploy of PR 1894 or later went out.

## Acceptance Criteria

- [ ] The owner has asked for the update. Before publishing: main pulled into the main
      checkout, and the phones' runtime checked against the update's runtime.
- [ ] Production is confirmed to run commit `070154757` or later.
- [ ] On the phone: the AI-sharing screen shows "Your pantry items and grocery lists, when
      Coach looks at them".
- [ ] Coach answers "what's on my grocery list?" from the real lists (`get_grocery_lists`).
- [ ] Coach proposes a pantry card for "I just bought eggs and milk" and for "I used up the
      rice"; save, Undo and save again all work; the reply does not claim more than the card
      shows.
- [ ] A grocery card for a recipe leaves off what the pantry already covers and Coach says so.
- [ ] Anything wrong becomes a fix PR or a todo.

## Implementation Notes

- Update command: `npm run update:preview -- --message "..."` (never pass `--platform`).
- The owner decides the spend for the live chats before any are run.

## Dependencies

- Owner request for the update; owner OK on model spend; a phone on the matching runtime.
- `P2-2026-11-16-coach-pantry-card-simulator-and-voiceover-check.md` is worth doing first, so
  the update does not ship a card nobody has seen.

## Risks

- An update reaches only builds on the same runtime.

## Updates

### 2026-11-16

- Initial creation
