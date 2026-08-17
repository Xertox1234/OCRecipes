---
title: "getDailyLogsInRange shares getMostEatenFoods' half-open loggedAt tie — lower severity, unconfirmed"
status: backlog
priority: low
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [deferred, database, testing]
github_issue:
---

# getDailyLogsInRange shares getMostEatenFoods' half-open loggedAt tie

## Summary

`getDailyLogsInRange` (`server/storage/nutrition.ts:291-304`) uses the same half-open
`gte(loggedAt, from)` / `lt(loggedAt, to)` range shape that was just confirmed (with
reproduction evidence) to cause an intermittent test failure in the sibling function
`getMostEatenFoods` — see `todos/archive/P2-2026-08-16-most-eaten-foods-test-intermittent.md`.
It shares more than the shape: its only caller passes the _same_ `today` boundary object as
`getMostEatenFoods`'s caller, from the same `Promise.all` in `coach-pro-chat.ts`.

## Background

Confirmed during the `getMostEatenFoods` fix (both `code-reviewer` and `server-reviewer`
independently surfaced this as the same deferred item):

```ts
// server/services/coach-pro-chat.ts:523,545,562
const today = new Date();
// ...
storage.getDailyLogsInRange(userId, sevenDaysAgo, today); // :545 — lt(loggedAt, today), half-open
storage.getMostEatenFoods(userId, thirtyDaysAgo, today); // :562 — now lte(loggedAt, today), inclusive
```

Both calls use the identical `today` instant. `getMostEatenFoods`'s tie was empirically
reproducible (~1 failure in 4 full-suite runs) because the tied-out row also crossed a
`HAVING count(*) >= 3` floor, turning a 1-row miss into a fully vanished result — an
amplifier `getDailyLogsInRange` does not have. Without that amplifier, the same tie in
`getDailyLogsInRange` degrades to silently dropping the single most-recent log row from
the 7-day window it feeds into the Coach Pro context builder — lower severity, and NOT
independently confirmed to occur (no observed test flake, no reproduction attempted here).

This todo exists to decide, deliberately, whether that theoretical tie is worth closing —
not to assume it needs the identical fix without checking `getDailyLogsInRange`'s own
callers and test coverage first, per the same discipline the P2 todo used.

## Acceptance Criteria

- [ ] Decide whether to reproduce this empirically (same technique as the P2 todo: full,
      unfiltered `npx vitest run <file> --retry 0` in a loop) or treat the shared-`today`
      mechanism as sufficient evidence without a live repro attempt
- [ ] If pursued: add test coverage for `getDailyLogsInRange` (currently zero, per
      `server/storage/__tests__/nutrition.test.ts` — confirmed via grep) that pins a log at
      exactly the `to` boundary and asserts it is included
- [ ] If the predicate changes (`lt` → `lte`), check every other caller of
      `getDailyLogsInRange` for tiling/adjacency risk (none is currently known, but verify
      rather than assume — see the P2 todo's caller-check discipline)
- [ ] Closes with a decision either way — "not worth fixing, no observed failure" is an
      acceptable close, but must be recorded

## Implementation Notes

- `server/storage/nutrition.ts:291-304` is the function; `coach-pro-chat.ts:545` is the
  sole caller.
- The P2 todo's reproduction technique (`--retry 0`, full unfiltered file, not `-t` filtered
  — the isolated filtered run never reproduced the sibling bug) is the reusable playbook if
  this is pursued empirically.
- `vitest.config.ts` sets a global `retry: 2` — always use `--retry 0` when investigating,
  or the flake silently self-heals.

## Scope Contract

- **Mechanisms to use:** the existing Vitest file and the existing query builder — no new
  test harness, no new fixture framework, no `retry` configuration
- **Files in scope:** `server/storage/__tests__/nutrition.test.ts`, and
  `server/storage/nutrition.ts` only if a predicate change is the deliberate decision
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None — independent of the P2 todo, which is already resolved.

## Risks

- Same risk class as the P2 todo: a probabilistic race is easy to "fix" by accident. If
  pursued, follow the same deterministic-pin-before-fix discipline (red under `lt`, green
  under `lte`) rather than trusting a hypothesis alone.
- Low severity means this could also reasonably be closed as won't-fix if a live repro
  attempt fails to reproduce it — that is a valid outcome, not a failure of this todo.

## Updates

### 2026-08-16

- Filed during the P2 `getMostEatenFoods` boundary-tie fix's code review — both
  `code-reviewer` and `server-reviewer` independently flagged the identical mechanism in
  `getDailyLogsInRange` as a deferred, lower-severity, unconfirmed item. Per
  `CLAUDE.md` → Deferred Item Todos, auto-filed as low-severity.
