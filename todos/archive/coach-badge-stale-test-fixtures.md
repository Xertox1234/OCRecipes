---
title: "Update stale CoachContextItem fixtures in reminders route test"
status: in-progress
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [testing, coach-badge]
---

# Update stale CoachContextItem fixtures in reminders route test

## Summary

The `POST /api/reminders/acknowledge` route test uses `CoachContextItem` shapes that include fields removed during Phase 1 finalization (`mealType` on `meal-log`, `goal` on `daily-checkin`). A `ReturnType` cast silences the TypeScript error, leaving misleading fixtures that don't match the actual type.

## Background

`server/routes/__tests__/reminders.test.ts:66-69`:

```ts
const mockContext = [
  { type: "meal-log", mealType: "breakfast", lastLoggedAt: null }, // mealType removed — Phase 2 only
  { type: "daily-checkin", calories: 1200, goal: 2000 },           // goal removed — Phase 2 only
];
vi.mocked(storage.acknowledgeReminders).mockResolvedValue(
  mockContext as ReturnType<...>,  // cast hides the type error
);
```

The actual `CoachContextItem` type in `shared/types/reminders.ts`:

```ts
| { type: "meal-log"; lastLoggedAt: string | null }
| { type: "daily-checkin"; calories: number }
```

Anyone reading this test will think `mealType` and `goal` are valid fields.

## Acceptance Criteria

- [ ] Fixture updated to match the current `CoachContextItem` type exactly
- [ ] `as ReturnType<...>` cast removed — the type should satisfy without it
- [ ] Test still passes and assertions verify the correct shape

## Implementation Notes

```ts
const mockContext: CoachContextItem[] = [
  { type: "meal-log", lastLoggedAt: null },
  { type: "daily-checkin", calories: 1200 },
];
vi.mocked(storage.acknowledgeReminders).mockResolvedValue(mockContext);
```

Also verify the assertion `expect(res.body.coachContext).toEqual(mockContext)` still holds.

## Dependencies

- None

## Risks

- Trivial — test-only change, no production code touched

## Updates

### 2026-05-01

- Identified during PR #45 code review
