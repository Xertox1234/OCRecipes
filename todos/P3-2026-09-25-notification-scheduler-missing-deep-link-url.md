---
title: "Server-driven Coach reminder push payload has no url field — the client entryId fallback is permanently load-bearing"
status: backlog
priority: low
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, reliability, server]
github_issue:
---

# Server-driven Coach reminder push payload has no url field — the client entryId fallback is permanently load-bearing

## Summary

`server/services/notification-scheduler.ts` (the primary Coach-reminder delivery path — the client's own `useNotebookNotifications.scheduleCommitmentReminder` is only a fallback for when server push isn't delivered) schedules its push payload with `data: { entryId: entry.id }` and no `url` field. `client/navigation/linking.ts`'s notification-tap handling (added in `todo/P2-2026-09-23-notification-tap-lost-on-cold-launch`) already tolerates this via a fallback that reconstructs `ocrecipes://notebook-entry/<id>` from a bare `entryId`, so there is no functional bug today. But that fallback was written to describe a time-bounded migration bridge for reminders scheduled by an old client build — in fact it is permanently load-bearing for the server-push path, which will keep sending `entryId`-only payloads indefinitely unless this todo is done.

## Background

Found during code review of `todo/P2-2026-09-23-notification-tap-lost-on-cold-launch` (`client-navigation/linking.ts` PR, reviewed at commit `bb36b484`/`2c6e30d0`). The reviewer's WARNING on that PR was about the comment wording implying the fallback was temporary; this todo is the actual code fix that would let it become temporary again by giving the server path a `url` field too, matching the client scheduler's shape.

- `server/services/notification-scheduler.ts:108-111` — the `notify(entry.userId, "commitment", {...})` call's `data` object.
- `client/hooks/useNotebookNotifications.ts` — the client-side scheduler, already updated to send `data: { entryId, url: "ocrecipes://notebook-entry/<id>" }`.
- `client/navigation/linking.ts` — `extractNotificationUrl` prefers `data.url`, falls back to constructing the URL from `data.entryId`.

## Acceptance Criteria

- [ ] `notification-scheduler.ts`'s commitment-reminder push payload includes a `url` field with the same `ocrecipes://notebook-entry/<id>` shape the client scheduler uses
- [ ] Existing tests for `notification-scheduler.ts` updated/extended to assert the new field
- [ ] No change to the `entryId` field (kept for back-compat with the client-side `extractNotificationUrl` fallback, which should NOT be removed by this todo — other, older payload shapes may still exist)

## Implementation Notes

Keep this a small, additive change to the `data` object passed to `notify(...)`. Do not touch `client/navigation/linking.ts`'s fallback logic — it should stay in place as defense-in-depth even after this ships (a defensive fallback costs nothing and there is no way to know every historical payload shape has aged out).

## Scope Contract

- **Mechanisms to use:** the existing `notify()` call's `data` object shape — nothing new.
- **Files in scope:**
  - `server/services/notification-scheduler.ts`
  - matching `__tests__/`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None (informational dependency: builds on the client-side work in the now-archived `todo/P2-2026-09-23-notification-tap-lost-on-cold-launch`, which already ships the reading side of this `url` field).

## Risks

- Low — additive field, no existing consumer reads or rejects on its presence.

## Updates

### 2026-09-25

- Filed from a code-review finding on `todo/P2-2026-09-23-notification-tap-lost-on-cold-launch` (commit `bb36b484`, WARNING addressed by rewording comments in `2c6e30d0`; this todo is the actual server-side fix the reworded comments point at).
