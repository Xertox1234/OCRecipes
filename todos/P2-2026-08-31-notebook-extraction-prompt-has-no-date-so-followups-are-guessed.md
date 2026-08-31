---
title: "The notebook extractor has no date anchor, so a user-stated check-in day is guessed — and the guess is written at UTC midnight"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, ai-prompting, coach, timezone, notifications]
github_issue:
---

# A relative check-in day with nothing to resolve it against

## Summary

`EXTRACTION_PROMPT` (`server/services/notebook-extraction.ts:26`) asks for
`followUpDate: ISO date string if this is a commitment with a check-in date, otherwise null`, and
`shared/schemas/coach-notebook.ts:31-35` accepts `^\d{4}-\d{2}-\d{2}$` **or null**. That prompt
contains no calendar date and no time.

So the model is not _forced_ to invent a date — it can, and does, return null. The defect is
narrower: when the user actually says "check in with me next week", the model has **nothing to
resolve that against**, and whatever it produces is written as UTC midnight and later compared
with `lte(followUpDate, new Date())`.

## Background

Found 2026-08-31 by the AI review of PR #892, which fixed the visible half of this class (the
coach's own prompt now states the user's civil date). This is the sibling it does not reach —
and unlike the meal-plan case, the user never sees the value before it acts.

Verified against `133e29ad` — **re-verified after review found three of the original five rows
wrong**; see the 2026-08-31 correction note at the end:

| Where                                       | What                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/services/notebook-extraction.ts:26` | `followUpDate: ISO date string … otherwise null` — the field is genuinely optional, and the prompt states no current date or time anywhere                              |
| `shared/schemas/coach-notebook.ts:31-35`    | `.regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()`                                                                                                                   |
| `server/services/coach-pro-chat.ts:897`     | `followUpDate: e.followUpDate ? new Date(e.followUpDate) : null` — bare parse, i.e. **UTC midnight**                                                                    |
| `server/storage/coach-notebook.ts:252`      | `lte(followUpDate, new Date())` inside **`getDueCommitmentsAllUsers`** — this is the one the push notification runs on (`server/services/notification-scheduler.ts:64`) |
| `server/storage/coach-notebook.ts:125`      | `lte(...)` inside `getCommitmentsWithDueFollowUp` — the _coach-context_ path (`coach-context-builder.ts:58`, `coach-pro-chat.ts:559`), NOT the notification path        |
| `server/storage/coach-notebook.ts:149`      | `lte(...)` inside `archiveOldEntries` — a different correctness bar; listed so a sweep does not miss or over-fix it                                                     |

System messages are filtered out of the transcript before this extraction runs, so the model
cannot recover the date from surrounding context either.

**Why it still matters even though the field is optional.** A wrong `plannedDate` shows up on the
Plan tab, where the user can see and fix it. A wrong `followUpDate` is invisible until it fires:
`getDueCommitmentsAllUsers` (`coach-notebook.ts:252`) drives a **push notification**
(`notification-scheduler.ts:64`), and `getCommitmentsWithDueFollowUp` (`:125`) re-injects "the
follow-up date has arrived" into the coach's context. The user's only signal is being asked about
a commitment on the wrong day.

## Acceptance Criteria

- [ ] `EXTRACTION_PROMPT` states the user's civil date (and the model is told to resolve relative
      phrases like "next week" against it), so `followUpDate` is derived rather than guessed.
- [ ] `followUpDate` is anchored with `civilDateToInstant(dateStr, tz)` rather than
      `new Date(dateStr)`, so the due comparison lands on the user's day — **and the fix covers
      `coach-notebook.ts:252` (`getDueCommitmentsAllUsers`, the notification path), not only
      `:125`.** Fixing `:125` alone satisfies the letter of this criterion and leaves the push
      firing early, which is the consequence that motivates the todo.
- [ ] A test pins a **UTC-negative** timezone and an instant where the UTC day and the user's day
      differ, asserting a commitment does not come due early. CI runs UTC, where it cannot fail.
- [ ] The prompt-hash cache implications are checked — `coach-pro-chat.ts` derives a template
      version from the system-prompt hash; confirm whether this prompt participates.

## Implementation Notes

`civilDateString` and `civilDateToInstant` already exist in `server/lib/civil-date.ts` and are the
right tools; PR #892 does the equivalent for the coach's own prompt and is the model to follow.

The tz has to reach `extractNotebookEntries`, which currently does not take one — check whether
the caller in `coach-pro-chat.ts` already has it (the chat route parses `X-Timezone`) before
adding a parameter.

Consider whether `followUpDate` should be `date` rather than `timestamp` in the schema. It is a
calendar day, not an instant — storing it as a timestamp is what makes the UTC-midnight anchoring
possible in the first place. That is a migration, so weigh it separately.

## Scope Contract

- **Mechanisms to use:** the existing `civilDateString` / `civilDateToInstant` helpers and the
  timezone already parsed on the chat route — no new date library.
- **Files in scope:** `server/services/notebook-extraction.ts`, `server/services/coach-pro-chat.ts`,
  `server/storage/coach-notebook.ts`, and their co-located tests. A column-type migration is
  explicitly OUT of scope unless separately agreed.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #892 landed the helpers and the pattern.

## Risks

- Changing extraction prompt text may invalidate a cache keyed on a prompt hash — verify which.
- Existing `coach_notebook` rows keep their UTC-midnight anchoring; as with `planned_date`, a
  backfill is not soundly computable, since no row records the offset it was written under.
- A test that does not pin a UTC-negative zone passes in CI while the defect stays live.

## Updates

### 2026-08-31

- Filed from the AI review of PR #892.
- **Corrected the same day, before merge.** The first draft claimed the extractor was "required to
  emit `followUpDate`" (it is `.nullable().optional()`, and the prompt says "otherwise null", so
  the stated parallel to `add_to_meal_plan`'s genuine `required: [...]` does not hold); named
  `getCommitmentsWithDueFollowUp` as the notification path (it is not — the scheduler calls
  `getDueCommitmentsAllUsers`); omitted the `lte` at `:252` that actually drives the push; and
  mislabelled `:149` as a due check when it is `archiveOldEntries`. It also asserted "every table
  row above was verified against the source", which was not true of three of the five. The rows
  above have now each been checked individually. Recording this because a wrong premise in a
  dispatchable todo becomes a decision record: `scripts/todo-gate-check.sh` returns CLEAR, so an
  unattended `/todo` run can pick this up and would have written the false framing forward.
