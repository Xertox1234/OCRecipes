---
title: "Fix test pollution causing pantry.test.ts to fail in the full suite"
status: backlog
priority: low
created: 2026-05-18
updated: 2026-05-18
assignee:
labels: [deferred, testing]
github_issue:
---

# Fix test pollution causing pantry.test.ts to fail in the full suite

## Summary

`server/routes/__tests__/pantry.test.ts` passes in isolation (14/14) but fails
when run as part of the full `npm run test:run` suite. The failure is caused by
state leaking from another test file, not by a defect in the pantry route.

## Background

Observed on 2026-05-18 while establishing a `/todo` baseline. A full
`npm run test:run` reported **2 failed test files** (5281 passed / 5283 total);
one was `pantry.test.ts`. Running `pantry.test.ts` on its own passes all 14
tests, which confirms test pollution — a separate test file mutates shared
module-level state (a mock, an in-memory cache, an env var, a singleton) that
`pantry.test.ts` then inherits.

Confirmed failing assertion in the full-suite run:

- `DELETE /api/pantry/:id` → "returns 400 for invalid ID" — expects `400`
  (request validation rejects the ID before lookup) but receives `404`
  (handler proceeded to a lookup and found nothing). The shift from a
  validation-layer rejection to a not-found result points at a mock or
  guard whose state was changed by an earlier file.

CI is currently green because the test job is **sharded** (3 shards) — the
polluting file and `pantry.test.ts` evidently land in different shards, so the
interaction only surfaces in a single-process local full run. That makes this a
local-developer-experience problem (non-green local baseline), not a CI blocker.

## Acceptance Criteria

- [ ] Identify the polluting test file(s). The baseline showed 2 failed files —
      `pantry.test.ts` plus one unidentified second file; investigate both.
- [ ] Determine the specific shared state being leaked (mock not reset,
      module-level cache/singleton not cleared, env var, fake timers, etc.).
- [ ] Fix at the source — restore proper isolation (e.g. `vi.clearAllMocks()` /
      `vi.resetModules()` in the offending file's `afterEach`, or clear the leaked
      cache via its `_testInternals`). Do not paper over it by reordering files.
- [ ] `npm run test:run` (full suite, single process) passes with 0 failures.

## Implementation Notes

- Reproduce: `npm run test:run` (full suite) fails; `npx vitest run
server/routes/__tests__/pantry.test.ts` (isolated) passes — that delta is the
  signal.
- Bisect the polluter: Vitest runs files in a deterministic order by default.
  Run `pantry.test.ts` together with progressively larger subsets of the files
  that precede it, or use `npx vitest run --sequence.shuffle` / `--no-isolate`
  to amplify the interaction, until the offending file is found.
- Likely culprits: a route/service test that registers a mock for a shared
  storage method or mutates a module-level cache (the codebase has several —
  `subscription-tier-cache.ts`, `verification-streak-cache.ts`, etc. — that
  expose `_testInternals` for clearing; a test that forgets to clear one would
  leak).
- The fix belongs in the **polluting** file's teardown, not in `pantry.test.ts`.

## Dependencies

- None.

## Risks

- The second failing file was not identified at baseline time — the
  investigation may uncover more than one pollution source.

## Updates

### 2026-05-18

- Initial creation (observed during a `/todo` baseline run).
