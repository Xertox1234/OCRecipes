---
title: "Fix CoachRemindersScreen query key mismatch with fetch URL"
status: done
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [bug, coach-badge, client, tanstack-query]
---

# Fix CoachRemindersScreen query key mismatch with fetch URL

## Summary

`useReminderMutes` in `CoachRemindersScreen` uses `["/api/reminders/mutes"]` as its TanStack Query key but fetches from `GET /api/user/dietary-profile`. The key/URL mismatch breaks cache coherence — updates to the dietary profile from other screens won't refresh the mutes panel, and mutes-specific invalidations won't affect anything that reads the full profile.

## Background

The project convention (stated in `docs/patterns/hooks.md`) is to use the fetch URL as the query key. `CoachRemindersScreen.tsx:42-50` diverges:

```ts
function useReminderMutes() {
  return useQuery<{ reminderMutes: ReminderMutes }>({
    queryKey: ["/api/reminders/mutes"],            // ← mismatched key
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/dietary-profile");
```

Scenario that breaks: user updates a dietary preference → `["/api/user/dietary-profile"]` is invalidated → mutes panel shows stale data because it's cached under a different key.

## Acceptance Criteria

- [ ] `useReminderMutes` uses `["/api/user/dietary-profile"]` as its query key
- [ ] `useUpdateReminderMute.onSuccess` updates the same key via `setQueryData`
- [ ] The full profile response is still returned and `reminderMutes` extracted from it
- [ ] No other screen's cache coherence is affected

## Implementation Notes

```ts
const DIETARY_PROFILE_KEY = ["/api/user/dietary-profile"] as const;

function useReminderMutes() {
  return useQuery({
    queryKey: DIETARY_PROFILE_KEY,
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/dietary-profile");
      return res.json(); // return full profile
    },
    select: (profile) => ({
      reminderMutes: (profile.reminderMutes ?? {}) as ReminderMutes,
    }),
  });
}
```

The `select` option transforms the cached full profile into the shape the screen needs, without storing a separate entry.

## Dependencies

- None (self-contained to `CoachRemindersScreen.tsx`)

## Risks

- If other hooks already cache `["/api/user/dietary-profile"]`, sharing the key will actually improve coherence — low risk

## Updates

### 2026-05-01

- Identified during PR #45 code review
