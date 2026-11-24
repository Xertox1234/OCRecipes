---
title: "Weekly report alarms can fire for one user, and once per user in an outage"
status: done
priority: low
created: 2026-11-23
updated: 2026-11-23
assignee:
labels: [reliability, observability]
github_issue:
---

# Weekly report alarms can fire for one user, and once per user in an outage

## Summary

Two alarm-shape problems in the weekly report run, found by `/code-review` on PR #1989 and
deferred because each needs a threshold or log-level decision.

## Background

- **All-failed alarm on one user.** `runWeeklyReports` in
  `server/services/notification-scheduler.ts` logs "weekly report failed for every user it
  tried" when `failed === tried`. In a catch-up hour everyone else is `exists` or skipped, so
  `tried` shrinks to the users who failed last time. One user with a bad row then raises the
  systemic alarm on every remaining tick of the window (up to three more times).
- **One Sentry error per user in an outage.** `writeWeeklyReport` in
  `server/services/weekly-report/writer.ts` logs every throw in its try block at `error`, by
  design (reliability audit 2026-11-12 M8). The template fallback counts as `created`, so a
  provider outage produces one error per Pro user in the window and never trips the all-failed
  alarm. A reply that is prose instead of JSON also logs an error for a handled fallback, after
  `parseAiJson` has already warned.

## Acceptance Criteria

- [x] The all-failed alarm does not fire when a single user fails in a catch-up hour (a
      minimum `tried`, or first hour of the window only).
- [x] A provider outage raises one alarm for the run, not one per user; the run summary counts
      template fallbacks.
- [x] The owner decides whether a reply-shape failure stays at `error` or drops to `warn`.

## Implementation Notes

Both paths have Vitest coverage in `server/services/__tests__/notification-scheduler.test.ts`
("run summary") and `server/services/weekly-report/__tests__/writer.test.ts`. Add the
single-user catch-up case and the outage case there first.

## Scope Contract

- **Mechanisms to use:** the existing `counts` object and logger calls; nothing new.
- **Files in scope:** `server/services/notification-scheduler.ts`,
  `server/services/weekly-report/writer.ts`, `server/services/weekly-report/generate.ts`, and
  their test files.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

- 2026-11-23: done. The all-failed alarm needs at least 2 users tried. The writer warns and names the AI fault; the scheduler counts `aiCallFailed` and `badReply` in the run summary and raises one error per run when an AI call failed. Owner ruling 2026-11-23: a reply-shape failure drops to `warn` (counted, never an error).
