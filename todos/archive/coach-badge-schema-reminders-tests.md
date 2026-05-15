---
title: "Add unit tests for coachContextItemSchema in shared/schemas/__tests__"
status: done
priority: low
created: 2026-05-02
updated: 2026-05-03
assignee:
labels: [testing, type-safety, coach-badge]
---

# Add unit tests for coachContextItemSchema

## Summary

`shared/schemas/reminders.ts` defines `coachContextItemSchema` but has no test file. Peer schemas in `shared/schemas/` (e.g., `coach-blocks.ts`, `saved-items.ts`) all have corresponding `__tests__/` files — adding tests here keeps coverage consistent.

## Background

`coachContextItemSchema` was introduced in commit `27a66c84` as part of replacing an unsafe `as CoachContextItem[]` cast in `server/storage/reminders.ts`. The schema uses `z.discriminatedUnion` over the `CoachContextItem` union from `shared/types/reminders.ts`, with a `satisfies z.ZodType<CoachContextItem>` constraint for compile-time drift protection.

A code review (2026-05-02) flagged the missing test file as the only gap in an otherwise clean implementation.

## Acceptance Criteria

- [x] Create `shared/schemas/__tests__/reminders.test.ts`
- [x] Happy-path test for each `CoachContextItem` discriminated union variant
- [x] Rejection test for an object with an unknown `type` value
- [x] Rejection test for a missing required field on at least one variant
- [x] All existing tests still pass (`npm run test:run`)

## Implementation Notes

Look at `shared/schemas/__tests__/saved-items.test.ts` for the test file convention used by peer schemas.

Each variant of `CoachContextItem` (defined in `shared/types/reminders.ts`) should have at least one `safeParse` happy-path assertion:

```ts
expect(
  coachContextItemSchema.safeParse({ type: "...", ...fields }).success,
).toBe(true);
```

And shared rejection cases:

```ts
expect(
  coachContextItemSchema.safeParse({ type: "unknown_variant" }).success,
).toBe(false);
expect(coachContextItemSchema.safeParse({}).success).toBe(false);
```

## Dependencies

- None — `shared/schemas/reminders.ts` already exists

## Risks

- Trivial — pure test additions, no production code changes

## Updates

### 2026-05-02

- Created following code review recommendation from coach-badge cleanup session

### 2026-05-03

- Implemented: created `shared/schemas/__tests__/reminders.test.ts` with 12 tests covering all 4 discriminated union variants, null field handling, unknown type rejection, and missing required field rejection. All tests pass.
