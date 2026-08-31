---
title: "A Date cannot express a calendar day — new Date('yyyy-mm-dd') is UTC midnight, whose civil day is the PREVIOUS one west of Greenwich"
track: bug
category: logic-errors
tags: [api, architecture, database, timezone, date, silent-failure, meal-plan]
module: server
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts, shared/lib/date.ts]
symptoms: ["An endpoint returns the previous day's data for users in the Americas, all day, every day", "A date bug that reproduces for every user at a negative UTC offset and never at a positive one", "Two values on one API response describe different days", "A duplicate-check passes and the insert then fails on a unique constraint", "Totals and their exclusion set disagree only near midnight", "Everything is correct in CI and on the developer's UTC-ish machine"]
created: '2026-08-31'
severity: high
---

# A `Date` cannot express a calendar day

## Problem

`Date` is an instant — a point on the timeline. A calendar day is not. When a `yyyy-mm-dd` from a
client or a `date` column is stored in a `Date`, the two meanings get conflated and the type
cannot tell them apart.

`new Date("2026-09-02")` is `2026-09-02T00:00:00Z`. Ask "which civil day is this instant in, for
this user" — which is what any timezone-aware day-bounds helper does — and the answer west of
Greenwich is **2026-09-01**:

```
Europe/Berlin        asked for 2026-09-02 -> bounds 2026-09-02 00:00 .. 23:59
UTC                  asked for 2026-09-02 -> bounds 2026-09-02 00:00 .. 23:59
America/New_York     asked for 2026-09-02 -> bounds 2026-09-01 00:00 .. 23:59   ← wrong day
America/Los_Angeles  asked for 2026-09-02 -> bounds 2026-09-01 00:00 .. 23:59   ← wrong day
```

Both pieces are individually correct. `new Date(dateStr)` parsing date-only forms as UTC is the ES
spec. Reading an instant's civil date in a target zone is the right way to bucket logs. Composed,
they return yesterday to half the planet.

## Symptoms

- **Constant, not edge-case.** Unlike most timezone bugs there is no "only in the evening" window:
  every request from a negative-offset user gets the previous day, 24 hours a day.
- **Sign-asymmetric.** Positive offsets are unaffected, because UTC midnight of day D is still
  day D for them. A developer in Europe cannot reproduce it at all.
- **Two values on one response disagree.** The worst version: one consumer converts the `Date`
  back to a string for a `date`-column comparison (wanting its *UTC* day) while another asks for
  its *civil* day in the user's zone. One `Date` cannot satisfy both, so the endpoint silently
  satisfies neither and the halves of one answer describe different days.
- **A duplicate pre-check passes and the write then fails on a unique constraint**, because the
  check searched a different day than the one the row lands on.
- Invisible in CI, which runs UTC — the one zone where every basis in such a system agrees.

## Root Cause

An overloaded type at an API boundary. `parseQueryDate(value) { return new Date(value); }` looks
like a parser and is really a lossy cast: it turns "the user means September 2" into "the instant
2026-09-02T00:00:00Z", and every downstream consumer has to guess which of the two was intended.

The second failure follows from the first: once the boundary hands out a `Date`, a helper whose
timezone parameter is *optional with a UTC default* will silently bucket on a different day than
its tz-aware sibling on the same response. A plausible default is what makes that invisible.

## Solution

**Name the two directions and stop overloading one type.**

```ts
/** The civil (calendar) date of an INSTANT, as seen in `tz`. */
export function civilDateString(date: Date, tz = "UTC"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/** An instant INSIDE civil date `dateStr` in `tz` — that day's local midnight. */
export function civilDateToInstant(dateStr: string, tz = "UTC"): Date {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return new Date(civilMidnightUtcMs(y, m, d, tz));
}
```

They are exact inverses, and **the round-trip is the contract**:
`civilDateString(civilDateToInstant(d, tz), tz) === d` for every zone and every day.

Then give each consumer the day in the shape it actually needs, rather than one `Date` for all:

| consumer                                     | takes                | why                               |
| -------------------------------------------- | -------------------- | --------------------------------- |
| anything bucketing timestamps                | instant + `tz`       | it needs a real point in time     |
| anything comparing a `date` **column**        | `"yyyy-mm-dd"`       | no conversion, so no timezone     |

**Keep the string at the boundary.** Have the query parser return the validated string, not a
`Date`, and make callers convert explicitly. Validate the format too — `new Date` accepts forms V8
parses in the *process* timezone (`2026/09/02`, `Sep 2, 2026`), whose round-trip then depends on
where the server runs.

**Make the timezone parameter required** on any helper whose answer depends on it, wherever a
sibling on the same response is already tz-aware. An optional `tz = "UTC"` reads as a safe default
and is really a silent second basis. Making it required turns the compiler into the search tool
that finds every call site at once.

## Prevention

**Ask what a `Date` in a signature MEANS, not just its type.** "Instant" and "calendar day" are
different domain types wearing the same TypeScript type. If a function takes a `Date` and its
doc comment does not say which, that is the smell.

**Test the round-trip across zones, and include the ugly ones.** Brute force is cheap here — 5475
round-trips over 15 zones and a full year runs in under a second, and it catches things unit
examples miss. Include zones that transition DST **at 00:00 local** (`America/Santiago`,
`Asia/Beirut`, `America/Havana`), where local midnight does not exist on the transition day and a
naive offset correction lands on 23:00 of the previous day; and quarter-hour offsets
(`Pacific/Chatham` +12:45, `Australia/Lord_Howe` +10:30, `America/St_Johns` −3:30).

**A guard that does not pin a non-UTC zone does not run.** CI is UTC. Prefer passing the zone as
request data (an `X-Timezone` header, an explicit `tz` argument) over pinning `process.env.TZ`:
the zone stops being ambient, so the test is deterministic *and* runs everywhere.

**Measure which zones catch which mutation — they differ.** Reverting the instant conversion is
caught only by **negative** offsets; reverting the tz on the day-bucketing call is caught at
**either** sign. A guard set that pins one sign only will miss the other defect entirely. Run the
mutation and record the per-zone counts rather than assuming "any nonzero offset works".

**Check that a header the server now depends on is actually sent.** Threading `tz` into a handler
is inert if the client never sends `X-Timezone` — and a shared `apiRequest` helper that does not
add it automatically means every call site is its own decision.

## Related Files

- `server/storage/helpers.ts` — `civilDateString`, `civilDateToInstant`, `civilMidnightUtcMs`
- `server/routes/_helpers.ts` — `parseQueryDateString`, which returns the string and validates it
- `server/routes/nutrition.ts`, `server/routes/goals.ts` — the two endpoints that composed the bug
- `server/storage/meal-plan-items.ts` — `getConfirmedMealPlanItemIds`, `tz` now required
- `server/storage/meal-plan-analytics.ts` — `getPlannedNutritionSummary`, takes the date string

## See Also

- [Two writers of one date column must share a normalisation basis](two-writers-of-one-date-column-must-share-a-normalisation-basis-2026-08-31.md) — the client-side half of the same story; that one is UTC-positive-only, this one UTC-negative-only
- [A rolling instant window spans N+1 calendar days](rolling-instant-window-spans-n-plus-1-calendar-days-2026-07-12.md) — the same instant-vs-calendar-day confusion expressed as window arithmetic
- [Timezone-aware day boundaries using Intl.DateTimeFormat](../conventions/timezone-aware-day-boundaries-intl-2026-05-31.md) — the underlying technique
