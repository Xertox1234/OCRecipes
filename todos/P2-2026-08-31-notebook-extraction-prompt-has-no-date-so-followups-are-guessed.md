---
title: "The notebook extractor is required to emit followUpDate but its prompt contains no date at all, and the guessed value is anchored at UTC midnight"
status: backlog
priority: medium
created: 2026-08-31
updated: 2026-08-31
assignee:
labels: [deferred, ai-prompting, coach, timezone, notifications]
github_issue:
---

# The same defect the coach prompt just had, one layer down and out of sight

## Summary

`EXTRACTION_PROMPT` (`server/services/notebook-extraction.ts`) asks the model for
`followUpDate: ISO date string`, and `shared/schemas/coach-notebook.ts:31-33` enforces
`^\d{4}-\d{2}-\d{2}$`. **That prompt contains no calendar date and no time** — so the model must
invent an absolute date, exactly as `add_to_meal_plan` had to before PR #892.

Two defects then stack: the guessed day, and the fact that the guess is written as UTC midnight
and later compared with `lte(followUpDate, new Date())`, which fires the evening _before_ the
user's local date for every UTC-negative user.

## Background

Found 2026-08-31 by the AI review of PR #892, which fixed the visible half of this class (the
coach's own prompt now states the user's civil date). This is the sibling it does not reach —
and unlike the meal-plan case, the user never sees the value before it acts.

Verified against `383375ac`:

| Where                                          | What                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `server/services/notebook-extraction.ts`       | `EXTRACTION_PROMPT` names `followUpDate` but contains no current date or time — grepped the whole prompt body |
| `shared/schemas/coach-notebook.ts:31-33`       | `.regex(/^\d{4}-\d{2}-\d{2}$/)` — an absolute date is mandatory                                               |
| `server/services/coach-pro-chat.ts:897`        | `followUpDate: e.followUpDate ? new Date(e.followUpDate) : null` — bare parse, i.e. **UTC midnight**          |
| `server/storage/coach-notebook.ts:125`, `:149` | `lte(coachNotebook.followUpDate, new Date())` — the due check                                                 |

The reviewer also notes that system messages are filtered out of the transcript before this
extraction runs, so the model cannot recover the date from surrounding context either.

**Why this one is worse than the meal-plan case it mirrors.** A wrong `plannedDate` shows up on
the Plan tab, where a user can see and fix it. A wrong `followUpDate` drives
`getCommitmentsWithDueFollowUp`, which is re-injected into the coach's context as "the follow-up
date has arrived" and feeds `server/services/notification-scheduler.ts` — a **push notification**.
The user's only signal is being asked about a commitment on the wrong day.

## Acceptance Criteria

- [ ] `EXTRACTION_PROMPT` states the user's civil date (and the model is told to resolve relative
      phrases like "next week" against it), so `followUpDate` is derived rather than guessed.
- [ ] `followUpDate` is anchored with `civilDateToInstant(dateStr, tz)` rather than
      `new Date(dateStr)`, so the due comparison lands on the user's day.
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

- Filed from the AI review of PR #892. Every table row above was verified against the source
  before filing rather than carried over from the review.
