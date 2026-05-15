---
title: "Zod-validate CoachContextItem from JSONB instead of casting"
status: done
priority: medium
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [type-safety, coach-badge, storage]
---

# Zod-validate CoachContextItem from JSONB instead of casting

## Summary

`acknowledgeReminders` in `server/storage/reminders.ts` maps Drizzle's JSONB `context` column (typed `Record<string, unknown>`) to `CoachContextItem[]` via an `as CoachContextItem[]` cast. The cast suppresses TypeScript's ability to catch malformed DB rows — a future caller that writes a bad `context` shape would fail silently at runtime, not at the type boundary.

## Background

`server/storage/reminders.ts:68-73`:

```ts
return acknowledged.map((r) => ({
  type: r.type,
  ...r.context,
})) as CoachContextItem[]; // ← cast on external-like JSONB data
```

`CoachContextItem` is a discriminated union in `shared/types/reminders.ts`. Drizzle returns `context` as `unknown` from JSONB. The cast silences the error but leaves the door open for malformed rows to corrupt downstream AI coach context.

## Acceptance Criteria

- [ ] Import the `CoachContextItem` Zod schema (or create one in `shared/schemas/`)
- [ ] Replace the `as CoachContextItem[]` cast with `z.array(coachContextItemSchema).parse(...)` or `safeParse` with error logging
- [ ] On parse failure, log the malformed row and filter it out rather than crashing
- [ ] All existing reminders route tests still pass

## Implementation Notes

If no Zod schema exists for `CoachContextItem`, create one in `shared/schemas/reminders.ts` mirroring the discriminated union in `shared/types/reminders.ts`.

Use `safeParse` per row and filter out failures:

```ts
return acknowledged
  .map((r) => {
    const result = coachContextItemSchema.safeParse({
      type: r.type,
      ...r.context,
    });
    if (!result.success) {
      logger.warn(
        { row: r.id },
        "reminders: malformed context JSONB — skipping",
      );
      return null;
    }
    return result.data;
  })
  .filter((item): item is CoachContextItem => item !== null);
```

## Dependencies

- None

## Risks

- Low — parse-and-filter is strictly safer than a cast; no schema changes needed

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
