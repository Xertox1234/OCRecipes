<!-- Filename: P3-2026-07-09-realdb-integration-test-harness.md -->

---

title: "Stand up real-DB HTTP integration test harness for one critical route group"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-09
assignee:
labels: [deferred, testing, integration]
github_issue:

---

# Stand up real-DB HTTP integration test harness for one critical route group

## Summary

Route tests currently `vi.mock("../../storage")` and `vi.mock("../../middleware/auth")`, so
they prove handler logic but never the real request → middleware → storage → DB path. Stand up
a supertest + real test-DB integration harness for one critical route group.

## Background

Split out of `P3-2026-06-27-broader-test-quality-non-mutation.md` (archived) so this initiative
can be scheduled independently. The [[project-auth-recurring-breakage]] wiring-seam gap (auth
changes repeatedly breaking in ways unit tests miss because route tests mock the middleware) is
the concrete symptom this closes. `test/db-test-utils.ts` already provides real-test-DB setup
(used today by `test/db-test-utils.test.ts` and `test/global-teardown.ts`) — reuse it rather than
building new DB scaffolding.

## Acceptance Criteria

- [x] Choose ONE critical route group (auth routes are the strongest candidate given the wiring
      gap above, but confirm before committing).
- [x] Build a supertest-based integration harness that exercises the real Express app, real auth
      middleware, and a real test database for that route group — no `vi.mock` of storage or
      auth in this suite.
- [x] Suite lives separately from the fast `preflight` unit/mutation gate (new file or directory,
      clearly labelled) so it doesn't slow the required fast checks.
- [x] Document how to run the new suite locally and whether/how it gates CI.

## Implementation Notes

- Reuse `test/db-test-utils.ts` for DB setup/teardown.
- This is a design task, not a mechanical split — expect to make real decisions about harness
  shape (per-test transaction rollback vs. truncate-between-tests, fixture strategy, how auth
  tokens are minted for authenticated requests) before writing the harness.

## Dependencies

- `test/db-test-utils.ts` (already exists).

## Risks

- Integration tests are slower and more flakiness-prone than unit tests — gating them into the
  fast required-check path would erode trust in that gate. Keep them separate and clearly
  labelled from the start.

## See Also

- `todos/archive/P3-2026-06-27-broader-test-quality-non-mutation.md` — the umbrella this was
  split from.

## Updates

### 2026-07-09

- Split from the `P3-2026-06-27-broader-test-quality-non-mutation.md` umbrella at user request,
  scoped to the contract/integration acceptance criterion only.

### 2026-07-12

- Implemented. Auth routes confirmed as the route group. New
  `test/integration/auth-routes.itest.ts` drives the real Express app (via `server/routes/auth.ts`'s
  real `register()`), the real `requireAuth` middleware, and the real `storage` layer against a
  real Postgres transaction (`test/db-test-utils.ts`, rolled back per test). Only `server/db`'s
  `db` export and `express-rate-limit` are mocked. Isolation from the fast gate uses a `.itest.ts`
  suffix (not `.test.ts`) plus a dedicated `vitest.integration.config.ts` + `npm run
test:integration:http` script — verified empirically that `vitest related` does not pick it up.
  Documented in `test/integration/README.md`.
  Beyond the AC's documentation requirement, also wired a non-required, advisory
  `integration-http` job into `.github/workflows/ci.yml` so an auth-wiring regression is caught
  automatically (visibly, not silently) on the introducing push, without ever gating a merge —
  see the PR body for the human-review note on this addition.
