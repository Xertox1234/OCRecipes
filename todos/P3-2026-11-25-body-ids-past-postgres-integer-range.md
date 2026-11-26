---
title: "Body ids past the Postgres integer range answer 500 instead of 400 (non-Coach routes)"
status: backlog
priority: low
created: 2026-11-25
updated: 2026-11-25
assignee:
labels: [deferred, api]
github_issue:
---

# Body ids past the Postgres integer range answer 500 instead of 400 (non-Coach routes)

## Summary

Request-body ids validated with `z.number().int().positive()` accept values above 2,147,483,647. They are bound to `serial`/`integer` columns, so Postgres throws "value out of range for type integer" and the route answers 500 (and reaches Sentry) instead of 400.

## Background

Found in the Coach chat audit 2026-11-24 (row L101). The Coach PR for bundle G slice 1 fixed the shared URL-param parser (`parsePositiveIntParam`, now bounded by `PG_INTEGER_MAX` in `server/routes/_helpers.ts`, which covers every route's `:id`) and the Coach body ids (notebook `ids`, warm-up `conversationId`, remix `sourceRecipeId`, recipe-chat `messageId`), using `z.int32().positive()`. The other body schemas are outside that audit, so they were deferred. Low: a client never sends such an id; the effect is a 500 and a Sentry event instead of a 400.

## Acceptance Criteria

- [ ] Every request-body id schema in the files below uses `z.int32().positive()` (or an equivalent upper bound).
- [ ] One route test per changed file shows an id of 2147483648 answers 400.
- [ ] Shared schemas that only describe server output (block payloads) are left alone, or the change is shown not to reject stored data.

## Implementation Notes

Sites found 2026-11-25 with `grep -rn "z\.number()\.int()\.positive()" server/routes shared/schemas`:

- `server/routes/meal-plan.ts`, `server/routes/_meal-plan-schemas.ts` (4), `server/routes/taste-picks.ts`, `server/routes/favourite-recipes.ts`, `server/routes/cookbooks.ts`, `server/routes/carousel.ts`, `server/routes/cooking.ts`, `server/routes/suggestions.ts`
- `shared/schemas/inspired-recipes.ts` (4), `shared/schemas/saved-items.ts`, `shared/schemas/taste-picks.ts` (3), `shared/schemas/recipe-finder.ts` (3), `shared/schemas/recipe-chat.ts` — check which of these parse request bodies before changing them.

Zod 4.6.7 `z.int32()` bounds to the signed 32-bit range (verified: 2147483648 fails, 2147483647 passes).
