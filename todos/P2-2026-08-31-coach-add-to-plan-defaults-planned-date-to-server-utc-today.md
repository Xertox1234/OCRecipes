---
title: "Two coach tools default their planned_date window to the SERVER's UTC today, which is the user's yesterday for part of every day at a positive offset"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, api, ai-prompting, meal-plan, timezone]
github_issue:
---

# The one server path that derives its own "today" for `planned_date`

## Summary

`addToMealPlanSchema` defaults `plannedDate` to `new Date().toISOString().split("T")[0]` —
the **server's** UTC calendar day. Railway runs UTC, so for any user at a positive offset this is
their previous day during the local window `[00:00, offset)`: two hours a day in `Europe/Berlin`,
twelve in `Pacific/Auckland`. The user asks the coach to add something to today's plan and it
lands on yesterday.

## Background

Found 2026-08-31 while implementing
`todos/archive/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`, which
moved the two **client** writers of `planned_date` to a device-local basis. An exhaustive grep of
`plannedDate`/`planned_date` across `server/` was run as part of that work to confirm no server
path derives a day and matches it against the column. This is the single exception found, and it
is a writer rather than a reader, so it was out of that todo's Scope Contract.

Verified against `2f2acd2c`:

| Where                                    | Code                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| `server/services/coach-tools.ts:106`     | `plannedDate: z.string().default(() => new Date().toISOString().split("T")[0])` |
| `server/services/coach-tools.ts:643`     | `plannedDate: parsed.data.plannedDate ?? toIsoDate(new Date())`                 |
| `server/services/coach-tools.ts:647`     | same                                                                            |
| `server/services/coach-tools.ts:143-145` | `toIsoDate` = `date.toISOString().split("T")[0]`                                |

**A second site, on the READ path** — found during the branch's own review sweep, after this todo
was first written:

| Where                                | Code                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `server/services/coach-tools.ts:609` | `const today = toIsoDate(new Date())`                                                 |
| `:610`                               | `const startDate = parsed.data.startDate ?? today`                                    |
| `:612`                               | `const endDate = parsed.data.endDate ?? defaultEnd`                                   |
| `:627`                               | `storage.getMealPlanItems(userId, startDate, endDate)` → `gte`/`lte` on `plannedDate` |

`getMealPlanSchema` (`:98-101`) marks **both** dates optional, so this default is far more
reachable than the write-side one — "what's on my plan this week" with no explicit dates is the
common phrasing. For a UTC-positive user during their local morning the window starts a day early
and ends a day short, so the coach reports the wrong days back to them.

Two separate things are wrong here:

1. **The basis.** All three produce the server's UTC day, not the user's civil day.
2. **`:643`/`:647` are dead.** Because the Zod schema at `:106` carries `.default(...)`,
   `parsed.data.plannedDate` is never `undefined`, so the `?? toIsoDate(new Date())` arms can
   never execute. They are not a second bug so much as a decoy — someone fixing only the
   `??` fallbacks would change nothing at all and could easily believe they had fixed it.

**The user's timezone is already available on this path.** `server/routes/chat.ts:534` already
computes `tz: parseTimezone(req.headers["x-timezone"])`, and `server/storage/helpers.ts` has
timezone-aware civil-date helpers. This is a plumbing job, not a new mechanism.

Note the NOTE at `coach-tools.ts:103`: `plannedDate` is marked **required** in the OpenAI JSON
tool definition, so the model normally supplies it and the default is a fallback. That is why this
is medium and not high — but the fallback is reachable whenever the model omits the field, and
nothing enforces that it doesn't.

## Acceptance Criteria

- [ ] When the model omits `plannedDate` (write path, `:106`) **or** `startDate`/`endDate` (read
      path, `:609-612`), the value used is the requesting user's civil date in their own IANA
      timezone, not the server's UTC date. Both sites, not just the write one.
- [ ] A test pins a **non-UTC** timezone and a fixed clock at an instant where the server's UTC
      day and the user's local day differ, and asserts the resulting `plannedDate`. A test that
      only passes under UTC does not close this — CI runs UTC, where the two agree.
- [ ] The dead `?? toIsoDate(new Date())` arms at `:643`/`:647` are either removed or made
      reachable, so the code cannot mislead the next reader about where the default comes from.
- [ ] No change to the client contract: the emitted `plannedDate` stays `yyyy-mm-dd`, matching
      `shared/schemas/coach-blocks.ts`'s `RecipeBrowserModal` params and the
      `/^\d{4}-\d{2}-\d{2}$/` validation at `server/routes/meal-plan.ts:80`.

## Implementation Notes

Thread the already-parsed `tz` from the chat route into the tool-execution path rather than
reaching for a new source of truth. Do **not** use `toLocalDateString` from `shared/lib/date.ts` —
its doc comment says why: on the server "local" is the host's zone, which is exactly the bug being
fixed here.

Prefer deriving the civil date with `Intl.DateTimeFormat(… { timeZone: tz })` (or the existing
helpers in `server/storage/helpers.ts`, which already do this for day bucketing) over any offset
arithmetic.

Consider whether the default should exist at all: if `plannedDate` is genuinely required in the
tool definition, an omission is a model error, and failing loudly may beat silently guessing a day.

## Scope Contract

- **Mechanisms to use:** the existing `parseTimezone` helper and the existing timezone-aware
  helpers in `server/storage/helpers.ts` — no new date library, no schema migration.
- **Files in scope:** `server/services/coach-tools.ts` (both `:106` and `:609-612`),
  `server/services/__tests__/coach-tools.test.ts`, and `server/routes/chat.ts` only as far as
  passing the already-computed `tz` through.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- `server/services/__tests__/coach-tools.test.ts:248` has a history of pinning the _current_
  behaviour rather than the intended property (it asserted the wrong field name through the whole
  life of a real bug, fixed in PR #885). Check that any test touched here asserts the property,
  not a snapshot of today's output.
- A test that does not pin a non-UTC `TZ` will pass in CI while the defect stays live —
  the same trap documented in
  `todos/P2-2026-08-31-plan-slot-timezone-guards-never-run-in-ci.md`.

## Updates

### 2026-08-31

- Filed from the server-impact sweep performed during the P1 local-date-basis work. Deliberately
  out of that todo's scope: it changed client writers only, and this is a server-side default.

### 2026-08-31 (later)

- Second site found on the READ path (`:609-612`, `get_meal_plan`) during the review sweep of the
  P1 local-date-basis branch. Scope and title widened from one site to two. The read-path default
  is the more reachable of the two, because its schema marks both dates optional.
