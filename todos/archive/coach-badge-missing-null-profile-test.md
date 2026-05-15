---
title: "Add test: PATCH /api/reminders/mutes when user profile doesn't exist"
status: in-progress
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [testing, coach-badge]
---

# Add test: PATCH /api/reminders/mutes when user profile doesn't exist

## Summary

The `PATCH /api/reminders/mutes` route correctly handles a null profile with `profile?.reminderMutes ?? {}`, but this path has no test coverage. A new user who hasn't completed onboarding could hit this path.

## Background

`server/routes/reminders.ts:58-68`:

```ts
const profile = await storage.getUserProfile(req.userId);
const existing = (profile?.reminderMutes ?? {}) as ReminderMutes; // null safe
const updated: ReminderMutes = { ...existing, ...parsed.data };
await storage.updateUserProfile(req.userId, { reminderMutes: updated });
```

The null-profile path is correct but untested. `server/routes/__tests__/reminders.test.ts` only tests the case where `getUserProfile` returns an existing profile.

## Acceptance Criteria

- [ ] Test added for `getUserProfile` returning `null`
- [ ] Asserts that the response contains only the incoming mutes (no stale merge)
- [ ] `updateUserProfile` is called with just the new mutes

## Implementation Notes

```ts
it("returns 200 with incoming mutes when no profile exists yet", async () => {
  vi.mocked(storage.getUserProfile).mockResolvedValue(null);
  vi.mocked(storage.updateUserProfile).mockResolvedValue(undefined);

  const res = await request(app)
    .patch("/api/reminders/mutes")
    .set("Authorization", "Bearer token")
    .send({ commitment: true });

  expect(res.status).toBe(200);
  expect(res.body.reminderMutes).toEqual({ commitment: true });
  expect(storage.updateUserProfile).toHaveBeenCalledWith(expect.any(String), {
    reminderMutes: { commitment: true },
  });
});
```

## Dependencies

- None

## Risks

- Trivial — test-only addition

## Updates

### 2026-05-01

- Identified during PR #45 code review
