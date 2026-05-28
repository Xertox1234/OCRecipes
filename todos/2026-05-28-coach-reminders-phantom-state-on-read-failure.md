---
title: "CoachRemindersScreen resets all toggles to ON and writes phantom state on read failure"
status: backlog
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, data-integrity]
github_issue:
---

# CoachRemindersScreen resets all toggles to ON and writes phantom state on read failure

## Summary

If the reminder-mutes read fails, `mutes` collapses to `{}` so every Switch renders ON; previously-muted categories silently appear reset, and toggling then writes against that phantom baseline.

## Background

Surfaced during a silent-failure investigation (unsolicited user report). This is a data-integrity concern, not just cosmetic: a write issued against a never-loaded baseline can persist incorrect mute settings.

## Acceptance Criteria

- [ ] On read failure the screen shows an error/retry rather than defaulting all toggles to ON.
- [ ] Toggle interaction is disabled until the mutes read succeeds, so no write can fire against a phantom baseline.

## Implementation Notes

- `client/screens/CoachRemindersScreen.tsx:78` reads `{ data, isLoading }` only — also read `isError`.
- Line 89 `const mutes = data?.reminderMutes ?? {}` masks a failed read as "nothing muted".
- Lines 107-138: each `Switch` value derives from `mutes`; line 138 only disables during `isLoading`/`updateMute.isPending` — extend the disabled/error handling so a failed read blocks interaction.

## Dependencies

- None.

## Risks

- Data integrity: a phantom write could overwrite a user's real mute preferences. Prioritize blocking writes on a failed read over cosmetic error UI.

## Updates

### 2026-05-28

- Initial creation. Finding verified by reading lines 78, 89, 107-138.
