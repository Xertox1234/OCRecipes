---
title: "A row limit added to a dedupe scan forgets the user's permanent decisions — bound the rows that are a cache, never the rows that are a decision"
track: bug
category: logic-errors
tags: [database, performance, architecture, drizzle, coach-notebook]
module: server
applies_to: ["server/storage/coach-notebook.ts", "server/storage/**/*.ts"]
symptoms: ["a fact the user removed or rejected is saved again after enough newer rows exist", "a performance change adds orderBy(desc(updatedAt)).limit(N) to a query whose result is used to decide 'do not insert this again'", "the test for the limit asserts that an old row outside the window is ignored, including an old rejected row"]
created: 2026-11-14
severity: medium
---

# A row limit added to a dedupe scan forgets the user's permanent decisions

## Problem

`refreshRepeats` in `server/storage/coach-notebook.ts` reads a user's existing notebook rows
before saving new facts, so a repeated fact refreshes its row and a fact the user rejected is not
saved again. A performance change (#1861) limited that read to the 200 newest rows. The limit
covered `rejected` rows too. After 200 newer rows, a fact the user had removed fell out of the
window and the next extraction saved it again. That silently undid the user's Undo / Remove.

## Symptoms

- One query serves two purposes: "is this a repeat" and "did the user say no to this".
- The limit's own test pinned the wrong behaviour: it expected an old rejected fact to be inserted.

## Root Cause

The two kinds of row age differently. An `active` row is a cache of what the coach knows; missing
an old one costs a duplicate. A `rejected` row is a decision by the user; it does not expire, so
no window over time or count is correct for it.

## Solution

Two reads: every `rejected` row with no limit, then `active` rows newest first with the limit.
The rejected rows go first in the merged list so a rejection wins when both exist. The reads are
sequential because a Drizzle transaction client takes one query at a time.

## Prevention

- Before adding a `LIMIT` to a read, name every decision made from its result. If one of them is
  "never do this again", that subset is read without the limit.
- The test for a scan limit has two rows outside the window: one that may be forgotten and one
  that must not be.

## Related Files

- `server/storage/coach-notebook.ts` — `refreshRepeats`, `REPEAT_SCAN_LIMIT`
- `server/storage/__tests__/coach-notebook.test.ts` — "bounds the scan of active rows but never forgets a rejected fact"

## See Also

- [capped oldest-first fetch starved by rows that stay eligible](capped-oldest-first-fetch-starved-by-rows-that-stay-eligible-2026-10-30.md) — another LIMIT that changed meaning, not only cost
