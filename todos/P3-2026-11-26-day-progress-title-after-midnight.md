---
title: 'Coach day card: the title can stay "Today so far" past midnight'
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, mobile]
github_issue:
---

# Coach day card: the title can stay "Today so far" past midnight

## Summary

client/components/coach/blocks/DayProgress.tsx works out its title from
`toLocalDateString(new Date())` during render. The React Compiler memoises
that with the block and query data, so a card that stays mounted across
midnight keeps saying "Today so far" for what is now yesterday, until its
data changes or it remounts. The numbers are right (the card reads its
stored date); only the label is stale. Found by the mobile review of the
T3 living-blocks PR.

## Fix

Read "today" from something that changes: a small `useLocalToday()` hook
that updates on AppState "active" and at the next local midnight, passed to
`dayProgressTitle` (client/components/coach/blocks/day-progress-utils.ts,
already pure). Add a test that the title moves to "Yesterday" when the day
turns.

## Acceptance

- A card made at 23:50 reads "Yesterday" after midnight without leaving the chat.
