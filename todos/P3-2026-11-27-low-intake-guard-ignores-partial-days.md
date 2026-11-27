---
title: "The low-intake guard skips days with one log, so a user logging one tiny entry a day never trips it"
status: backlog
priority: low
created: 2026-11-27
updated: 2026-11-27
assignee:
labels: [deferred, server, ai, safety]
github_issue:
---

# The low-intake guard skips days with one log

## Summary

`isLowIntake` (`server/services/weekly-report/facts.ts`) counts only days with
at least `FULL_DAY_MEALS` (2) logs. A user who logs one very small entry a
day never trips it. The weekly report and the Coach's `get_intake_history`
then show and praise intake numbers they should hold back.

## Background

The security review of the get_intake_history PR raised this as a
suggestion. It was deferred because the rule is shared with the weekly
report, so changing it changes reports too. That needs its own tests and a
look at false positives.

## Implementation Notes

- Also trip the guard when most logged days, partial ones included, are under
  the line. A partial total can only push toward the guard, which is the safe
  direction, as the facts.ts comment already says.
- Re-run `server/services/weekly-report/__tests__/facts.test.ts` and
  `server/services/__tests__/coach-intake-history.test.ts`.

## Acceptance Criteria

- [ ] Seven days of one tiny log each trips the guard in both the weekly report and get_intake_history.
- [ ] A normal week with a couple of one-item days does not.
