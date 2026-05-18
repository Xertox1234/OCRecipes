---
title: "Fix test pollution causing pantry.test.ts to fail in the full suite"
status: blocked
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

### 2026-05-18 — Investigated; blocked (premise contradicted by existing project knowledge)

- Automated `/todo` execution investigated this and **could not complete it as
  specified** — the todo's root-cause premise (a single polluting test file
  mutating shared module-level state) is contradicted by the evidence and by
  prior documented findings.

- **Reproduced the failure.** `npm run test:run` is intermittently red: across
  ~21 full-suite runs, 2 runs failed (one with 1 failed file, one with 3). All
  other 19 runs passed 5299/5299. All implicated files
  (`cooking.test.ts`, `recipes.test.ts`, `pantry.test.ts`) pass in isolation,
  and `npx vitest run server/routes/__tests__/` (all route tests together)
  passes too. The victim file is not deterministic — it shifts between
  `pantry.test.ts`, `cooking.test.ts`, and `recipes.test.ts` run-to-run.

- **The failure fingerprint is a vitest `vi.mock`-application race, not state
  pollution.** Captured failure modes:
  - `recipes.test.ts` GET `/api/meal-plan/catalog/search` → `expected 401 to
be 200`. A `401` is only emitted by the **real** `requireAuth`
    (`server/middleware/auth.ts`). The test relies on `vi.mock(
"../../middleware/auth")` resolving the manual mock — a `401` means that
    `vi.mock` did not apply and the real middleware ran.
  - `recipes.test.ts` GET `/api/recipes/browse` → `expected 403 to be 200`.
  - `cooking.test.ts` GET `/api/cooking/sessions/nonexistent` → status `404`
    but `body.code` is `undefined`. The real `getSessionForUser` in
    `server/routes/cooking.ts` **always** calls `sendError(res, 404, ...,
ErrorCode.SESSION_NOT_FOUND)`, so a 404 with no `code` field cannot come
    from the real route handler — it is Express's default 404, i.e. the
    cooking routes were not registered, consistent with `vi.mock(
"../../services/cooking-session")` failing to apply.

- **This is already documented.** `docs/LEARNINGS.md` →
  "Load-Induced vitest `vi.mock` Application Flake — `verification.test.ts:454`
  False-Red `expected 401 to be 404`" (2026-05-17) describes this exact
  phenomenon and the exact `401`-from-mocked-auth fingerprint, and
  `todos/archive/2026-05-15-flaky-full-suite-fork-pool-starvation.md` covers the
  same load-induced flake family (different symptom). The LEARNINGS entry
  explicitly instructs: **"Do not add a defensive retry or a symptom-level guard
  to the test... Only a reproduced root cause justifies a code change here."**

- **No polluting file exists.** Audited every test file for `resetAllMocks` /
  `restoreAllMocks` — the three that use them
  (`logger.test.ts`, `receipt-validation.test.ts`,
  `notification-scheduler.test.ts`) all scope the reset to `beforeEach`, which
  cannot leak across files. No shared mutable singleton (`*-cache.ts`
  `_testInternals`, `cookingSessionStore`) is leaked across files: with
  `isolate: true` (the vitest default, in `vitest.config.ts`) each test file
  gets a fresh module graph. There is no "offending file's teardown" to fix.

- **Manual intervention needed.** This todo should be **closed as not-a-bug /
  won't-fix** (the failure is a known vitest-internal mock-application race
  under machine load; CI is sharded and consistently green). If deeper work is
  desired, it should be re-scoped as "investigate / mitigate the vitest
  `vi.mock`-application race" — e.g. evaluate `vi.mock` hoisting reliability
  under the forks pool, or further bound local fork concurrency — NOT as
  "find and fix a polluting test file," which has no answer.
