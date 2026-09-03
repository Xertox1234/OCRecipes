---
title: "Batch-scan grocery lists are titled and dated from a UTC basis, so an evening scan west of Greenwich is stamped tomorrow"
status: backlog
priority: medium
created: 2026-09-03
updated: 2026-09-03
assignee:
labels: [deferred, database, server]
github_issue:
---

# Batch-scan grocery lists carry a UTC-basis calendar day

## Background

Deferred from the PR #899 merge review (2026-09-03), which fixed the same bug class on
the three client screens but left this server-side site open. PR #899's own todo changelog
named it; no todo existed for it, so this is that todo.

`server/storage/batch.ts:136` builds the calendar day for a newly created batch-scan
grocery list with:

```ts
const today = toDateString(new Date());
```

`toDateString` (`shared/lib/date.ts:2`) is `date.toISOString().split("T")[0]` — a **pure
UTC basis**. `today` is then used for three things on the row it creates:

```ts
title: `Batch Scan - ${today}`,
dateRangeStart: today,
dateRangeEnd: today,
```

This is the defect class already codified in
`docs/solutions/logic-errors/a-date-cannot-express-a-calendar-day-2026-08-31.md`: a `Date`
cannot express a calendar day, and `toISOString()` answers in UTC's day, not the user's.
Verified by reading both files on 2026-09-03; `toDateString`'s body is two lines and
unambiguous.

**User-visible effect:** a user scanning after 17:00 PDT (00:00 UTC) gets a list titled
and dated **tomorrow**. West of Greenwich the window is the evening; east of it the
symmetric early-morning case stamps yesterday.

**Why this is medium and not high.** Traced every reader of the two columns on
2026-09-03:

- `client/screens/meal-plan/GroceryListsScreen.tsx:111` — display only, via `formatDateRange`.
- `shared/schema.ts:1239` — `grocery_lists_user_date_idx` on `(userId, dateRangeStart)`.
- **No `where` / `orderBy` / `gte` / `lte` clause anywhere in `server/` filters on
  `dateRangeStart` or `dateRangeEnd`** (grepped; zero hits).

So the wrong value is displayed and indexed but never used to select or bucket rows. No
data loss, no security impact, nothing silently dropped from a query — a wrong label on a
real row.

## The second writer (do not fix this site alone without checking it)

`server/routes/grocery.ts:156-157` also writes these columns, from user-supplied
`parsed.data.startDate` / `endDate`. That is a _different input basis_ from
`batch.ts`'s server clock. This is exactly the shape
`docs/solutions/logic-errors/two-writers-of-one-date-column-must-share-a-normalisation-basis-2026-08-31.md`
records — two writers agreeing on a column and disagreeing on the basis of what they put
in it. Decide the intended basis for the column once and make both writers honour it,
rather than patching only the site this todo names.

## Acceptance Criteria

- [ ] `server/storage/batch.ts` no longer derives a calendar day from a UTC basis; it uses
      `server/lib/civil-date.ts` (`civilDateString`) with an explicit timezone.
- [ ] The timezone actually reaches this code path. **Verify by execution that the caller
      supplies one** — do not assume a header is sent because the server parses it. (An
      identical assumption was the CRITICAL finding in the PR #901 review: the chat route
      parsed `X-Timezone` while no client ever sent it, making that fix a production
      no-op.) If no timezone is available at this call site, say so and treat plumbing it
      as part of this todo, not a follow-up.
- [ ] `server/routes/grocery.ts:156-157` is examined in the SAME change and either brought
      onto the same basis or explicitly documented as intentionally different, with the
      reason.
- [ ] A test pins the behaviour at BOTH offset signs (a UTC-negative and a UTC-positive
      zone), with the zone passed as explicit data — not via ambient `process.env.TZ`, and
      not in a `describe.each` table (tables evaluate before hooks; see
      `docs/solutions/logic-errors/each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md`).
- [ ] Mutation-tested two-sided: reverting the fix makes the new assertions FAIL. A test
      that passes under CI's UTC either way is a decoration — UTC is the one zone where
      both bases agree.

## Implementation Notes

- ESLint blocks `toLocalDateString` from `server/**`, so the device-local helper is not
  the answer here; `server/lib/civil-date.ts` is.
- `toDateString` has other callers — this todo covers only `server/storage/batch.ts`.
  Changing the shared helper's semantics is out of scope and would be a much wider change.
- A pure date helper cannot live behind the storage facade (recorded in the same wave as
  the civil-date work) — keep the conversion in `server/lib/`, not in `server/storage/`.

## Scope Contract

- **Files in scope:** `server/storage/batch.ts`, its test file, `server/routes/grocery.ts`
  (examination, and change only if the basis decision requires it), and this todo.
- No changes to `shared/lib/date.ts` or to any other `toDateString` caller.
