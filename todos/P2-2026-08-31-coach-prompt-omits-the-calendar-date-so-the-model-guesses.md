---
title: "The coach prompt tells the model the weekday and clock time but never the calendar date, while requiring it to emit plannedDate"
status: backlog
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

- [ ] The system prompt states the user's **calendar date** alongside the weekday and time, in
      their own timezone. The values are already in scope at `server/services/nutrition-coach.ts:290`.
- [ ] A test asserts the rendered prompt contains the civil date for a **non-UTC** timezone at an
      instant where the user's date and the server's UTC date differ. A UTC-only test does not
      close this.
- [ ] `plannedDate` staying `required` in the tool definition is either confirmed as correct once
      the model has the date, or changed — with the NOTE at `coach-tools.ts:104` kept honest either
      way.
- [ ] `server/services/coach-context-builder.ts:70` uses the user's hour, not the server's.

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
