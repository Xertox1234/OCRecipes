---
title: "The coach prompt tells the model the weekday and clock time but never the calendar date, while requiring it to emit plannedDate"
status: done
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, ai-prompting, meal-plan, timezone, coach]
github_issue:
---

# The model is required to supply a date it has no basis to compute

## Summary

`buildSystemPrompt` injects `Current time for this user: ${weekday} ${hour}:${minute} ${dayPeriod}`
(`server/services/nutrition-coach.ts:397-407`) — weekday and clock time in the user's zone, and
**no year, month or day**. Meanwhile `coach-tools.ts:392` marks `plannedDate` **required** and
describes it as "Date in YYYY-MM-DD format". So for "add chicken to my plan for today" the model
must emit a calendar date it was never told, and whatever it guesses flows through to a real
`meal_plan_items` row.

## Background

Found 2026-08-31 by the server review of PR #890, which fixed the _fallback_ on this path: the
Zod `.default()` that filed the server's UTC day was replaced with a call-site default in the
user's zone (`todos/archive/P2-2026-08-31-coach-add-to-plan-defaults-planned-date-to-server-utc-today.md`).

**That fix is a strict improvement but does not cover the dominant path.** The reviewer traced it:
`parsed.data.plannedDate ?? civilDateString(new Date(), tz)` only reaches the `??` arm when the
model **omits** the field. When the model guesses a date — which is what the tool definition asks
it to do — the guess passes through untouched to `RecipeBrowserScreen.tsx:564`, where
`addItemMutation.mutateAsync` writes the row.

Two facts that decide the shape of the fix, both verified during that review:

- **`required` is a hint, not a constraint.** The tool definitions carry no `strict: true` — the
  `function` objects have only `name`/`description`/`parameters` — so the model can and does omit
  the field. That is why the new fallback is reachable at all.
- **Dropping `plannedDate` from `required` is NOT sufficient on its own.** It would make "today"
  resolve server-side, but leave the model unable to compute "Friday" or "tomorrow" — trading one
  wrong-date class for another.

The write reaches the DB through the **navigate → RecipeBrowserModal** path, not through
`PlanSlotPickerSheet`. `CoachChat.tsx:512`'s `handleConfirmPlanSlot` takes its `plannedDate` from
the chip the user tapped, which `plan-slot-picker-utils.ts` derives locally — so auditing the
picker and concluding the server's value is inert would be a mistake.

## Acceptance Criteria

- [x] The system prompt states the user's **calendar date** alongside the weekday and time, in
      their own timezone. The values are already in scope at `server/services/nutrition-coach.ts:290`.
- [x] A test asserts the rendered prompt contains the civil date for a **non-UTC** timezone at an
      instant where the user's date and the server's UTC date differ. A UTC-only test does not
      close this.
- [x] `plannedDate` staying `required` in the tool definition is either confirmed as correct once
      the model has the date, or changed — with the NOTE at `coach-tools.ts:104` kept honest either
      way.
- [x] `server/services/coach-context-builder.ts:70` uses the user's hour, not the server's.

## Implementation Notes

The prompt fix is the minimum correct one and is small: render `civilDateString(now, tz)` into the
existing "Current time for this user" line rather than adding a new one, so there is one temporal
statement in the prompt and it cannot drift from itself.

**Second, smaller defect in the same subsystem** (`coach-context-builder.ts:70`):
`const hour = new Date().getHours()` is the _server's_ local hour — UTC on Railway — and gates the
suggestion chips (`< 11` → "Quick breakfast ideas", `>= 17` → "How was my day?"). `tz` is already a
parameter of that same function and used at `:51`. An LA user at 8am PDT (15:00 UTC) gets neither
chip; at 6pm PDT (01:00 UTC) they are offered "Quick breakfast ideas". Cosmetic rather than a data
defect, but it is the last `new Date()`-in-the-server's-basis in this subsystem, so it belongs in
the same change.

## Scope Contract

- **Mechanisms to use:** the existing `civilDateString` helper (`server/lib/civil-date.ts`) and the
  timezone already threaded into both functions — no new date library.
- **Files in scope:** `server/services/nutrition-coach.ts`,
  `server/services/coach-context-builder.ts`, `server/services/coach-tools.ts` (only the tool
  definition / NOTE), and their co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. The fallback half shipped in PR #890.

## Risks

- Changing prompt text invalidates the coach response cache keyed on the system-prompt hash
  (`coach-pro-chat.ts` derives the template version from it) — expected, but worth noting so a
  cache-miss spike after deploy is not mistaken for a regression.
- A prompt test that pins exact wording will break on every future prompt edit. Assert that the
  civil date is _present and correct_, not the surrounding sentence.

## Updates

### 2026-08-31

- Filed from the final server review of PR #890, which fixed the omit-path fallback and identified
  this as the remaining, more common path. Both findings verified by that review against the live
  prompt body and the tool definitions.

### 2026-08-31 — RESOLVED

The prompt's "Current time for this user" line now carries the user's calendar
date in `yyyy-mm-dd`, rendered with `civilDateString(now, tz)` — the exact format
`add_to_meal_plan` asks for, so the model copies rather than derives it. Kept on
the one existing line rather than added as a second sentence, so the prompt
cannot state two different "now"s.

`plannedDate` stays **required**, which is now defensible rather than merely
inherited: the model has the date it is being asked for. That is a real coupling,
so it is recorded at `coach-tools.ts` — if the date is ever removed from the
prompt, the field must stop being required or the guessing returns.

`coach-context-builder.ts` now resolves the suggestion-chip hour in the user's
zone, via a new `civilHourInTz` in `server/lib/civil-date.ts` rather than a third
inline `Intl` formatter.

**Correction — the original version of this note was wrong on both clauses, and
both reviewers caught it independently.** It said `hour12: false` renders midnight
as "24" and that hour 24 would "fall through both branches". Measured on Node
24.9.0 / ICU 77.1 across nine zones: `hour12: false` and `hourCycle: "h23"` both
render midnight `"00"`; only `hourCycle: "h24"` renders `"24"`. And `24 >= 17` is
true, so an hour of 24 would serve the **evening** chip, not none. `h23` is still
the right choice — it is explicit rather than relying on which `hour12` → hourCycle
mapping the runtime implements — and the midnight test does guard the hazard, just
via `h24` rather than `hour12: false`.

**A test of mine passed when it should have failed, and that is the finding worth
keeping.** The first version of the chip tests asserted the right things and went
green _before_ the fix, because the buggy code read `new Date().getHours()` — the
HOST zone — and this machine happens to sit near the zone under test. The host
timezone was an uncontrolled input. Pinning `process.env.TZ = "UTC"` in the block
(which is also what CI runs) made the two discriminating cases genuinely red, and
a `getTimezoneOffset()` assertion now guards the pin itself. Writing the test
first is what surfaced it: green-when-expecting-red is a signal, not luck.

Fixing the implementation then broke three **pre-existing** tests that set a
local-time instant (`new Date(2026, 4, 15, 8, ...)` = 8am on the host) and relied
on the implementation reading that same host zone. They now state the zone
explicitly — `Date.UTC(...)` plus an explicit `"UTC"` argument — so the intent is
in the test rather than in the machine.

Mutation-checked both: removing the date from the prompt fails 6 tests; reverting
the chip hour to the server's fails **2**.

**That second number was originally recorded as 3, and the 3 was this machine's.**
Both reviewers measured it host-dependent — 3 on `America/Denver`, 2 on UTC (what
CI runs), 5 on `Pacific/Auckland` — because the three pre-existing tests had been
pinned by _argument_ but not by `process.env.TZ`, leaving them host-coupled as
mutation detectors. The `TZ` pin has since been moved to **file** scope, so the
count is now 2 under every host zone tested (UTC, Denver, Berlin, Auckland) and
green under all of them. A mutation count that varies by developer is not
evidence; this one now is.

That is the same lesson as the one above, landing twice in one change: the host
timezone was an uncontrolled input in the _evidence_ as well as in the test.

Also fixed here, from the review of this change:

- `addToMealPlanSchema.plannedDate` was a bare `z.string()` — the weakest
  validation in a file where every other date uses `isoDateSchema` (regex plus
  `isValidCalendarDate`). `"next Friday"`, `"07/10/2026"` and `"2026-02-30"` all
  passed, reaching the client's `isBrowseOnly` check and failing only at the
  route, which surfaces as "Couldn't add the recipe to your plan. Please try
  again." — a permanent failure worded as a transient one. Now `isoDateSchema`,
  with `mealType` an enum rather than a free string, so `invalidArgs` routes the
  problem back to the model instead.
- The tool parameter descriptions now tell the model to resolve relative days
  against the date in USER CONTEXT. Stating the date is necessary but not
  sufficient — "add this for Sunday" still needs arithmetic, and nothing told it
  where to anchor.
- `hashCoachCacheKey`'s `dayBucket` is required rather than defaulting to UTC —
  the same plausible-default trap, on a parameter that now has to agree with the
  prompt's date.
