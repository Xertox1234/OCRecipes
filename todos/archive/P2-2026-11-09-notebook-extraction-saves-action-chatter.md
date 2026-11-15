---
title: "Notebook extraction saves food-log / planning chatter as notebook entries"
status: done
priority: medium
created: 2026-11-09
updated: 2026-11-15
assignee:
labels: [deferred, coach]
github_issue:
---

# Notebook extraction saves action chatter as notebook entries

## Summary

In the PR #1812 simulator check, two ordinary requests got saved as notebook entries, each with a "Saved to your notebook · Undo" popup:

- "I had two eggs and a slice of toast" became "You are trying 3 eggs and 2 slices of toast for breakfast".
- "Plan my dinners for the next three days, high protein" became "You have committed to planning your dinners for the next three days…".

## Background

The extraction from #1809 treats one-off actions as lasting facts and commitments. The popup also overlaps the new write card that answers the same message.

## Acceptance Criteria

- [x] Extraction skips turns whose only content is a one-off log, shopping or planning request, especially when the turn produced a write card.
- [x] Add a test for each of the two messages above, showing no notebook entry is created.

## Implementation Notes

- `server/services/notebook-extraction.ts` (prompt and filters).
- `server/services/chat-turn.ts` (could skip extraction when a write tool ran in the turn).

## Updates

### 2026-11-15

- When the coach answers a turn with a write card, extraction drops that turn's commitment, insight and conversation-summary entries. Preferences, goals and motivations from the same message are kept ("I'm vegetarian now, log two eggs"), and the mood nudge still runs.
- The extraction prompt now says a request to log food, add to a grocery list or plan meals is not an entry. This covers turns with no card (an app that does not send `writeCards`). It has not been run against a real model.
- Tests: both messages from the Summary, with the entries the model wrote, save nothing on a card turn.
