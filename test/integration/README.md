# Real-DB HTTP Integration Tests

`*.itest.ts` files in this directory drive the real Express app — real route
registration, real `requireAuth` middleware, real `storage` layer — through
[`supertest`](https://github.com/ladjs/supertest) against a real Postgres
transaction (rolled back after every test via `test/db-test-utils.ts`). No
`vi.mock` of `storage` or `middleware/auth`.

This exists to close a gap the rest of the suite leaves open: every route
test under `server/routes/__tests__/` mocks both storage and auth middleware,
which proves handler logic but never the real request → middleware → storage
→ DB composition. See
[`docs/solutions/conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md`](../../docs/solutions/conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md)
for the full rationale and `[[project_auth_recurring_breakage]]` for why auth
was chosen as the first route group.

## Running locally

```bash
npm run test:integration:http
```

This runs `vitest run --config vitest.integration.config.ts`, which scopes
discovery to `test/integration/**/*.itest.ts` only. It needs a real,
reachable Postgres (the same `DATABASE_URL` your other tests use — see
`docs/DEV_SETUP.md` / `npm run db:push`).

## Why these files are NOT picked up by `npm run test:run` / `preflight:fast`

The `.itest.ts` suffix (not `.test.ts`) means the base `vitest.config.ts`'s
`include: ["**/*.test.ts", "**/*.test.tsx"]` never matches these files — so:

- `npm run test:run` (and CI's existing `Tests`/`Coverage` jobs, which
  already run that script against a real Postgres service) do **not**
  execute this suite.
- `preflight:fast`'s `npx vitest related --run <changed files>` step
  (the fast local push gate) never discovers or runs this suite either, even
  when a push touches `server/routes/auth.ts` or `server/middleware/auth.ts`
  — the exact files this suite imports. Verified empirically: `vitest
related --run server/routes/auth.ts server/middleware/auth.ts` returns the
  existing route/middleware test files and none of this directory's.

This is a deliberate choice, not an oversight: real-DB HTTP tests are slower
and more flakiness-prone than the mocked unit/route suite (bcrypt at cost 12,
real Postgres round-trips), and gating them into the fast push-time path or
the _required_ CI checks would erode trust in those gates over time — the
concern the originating todo (`P3-2026-07-09-realdb-integration-test-harness`)
raised explicitly.

## CI: advisory, non-blocking, but automatic

A manual-only suite closes the auth-wiring gap only in theory — nobody runs
it on the push that actually introduces a regression. So this suite IS wired
into CI, as its own `integration-http` job in `.github/workflows/ci.yml`
(`needs: checks`, provisioning its own Postgres service container that
mirrors the `test`/`coverage` jobs' configuration — GitHub Actions service
containers are job-scoped, so this is a fresh instance, not a shared one).
It is a **plain job — real pass/fail, fully visible
in the PR checks list** — kept non-blocking by exactly one mechanism: it is
**not** added to branch protection's required status checks, so its result
cannot gate a merge regardless of outcome.

(Deliberately not `continue-on-error: true`: at the job level GitHub reports
`job.result` as `"success"` even when a step inside it failed — only the
overall workflow-run conclusion still reflects the failure — which would
make a real auth-wiring regression here read as green/passing instead of
visibly failed. Omission from the required-checks list is the unambiguous
way to be "visible but non-blocking.")

Net effect: an auth-wiring regression is caught and visibly shown as failed
on the PR that introduces it, without the flakiness/latency risk this suite
carries ever being able to block a merge.

## Harness shape

- **Isolation:** one Postgres transaction per test, rolled back in
  `afterEach` (`setupTestTransaction()` / `rollbackTestTransaction()` from
  `test/db-test-utils.ts`) — the same mechanism every
  `server/storage/__tests__/*.test.ts` suite already uses. Not
  truncate-between-tests: rollback is faster and can't leak a partial write
  from a failed assertion.
- **What's mocked:** only `server/db`'s `db` export (redirected to the
  current test's transaction) and `express-rate-limit` (project-standard
  pass-through, `__mocks__/express-rate-limit.ts` — purely so the shared
  in-memory limiter store can't leak a 429 into an unrelated test case).
  `storage` and `middleware/auth` are the real modules.
- **Fixtures:** `createTestUser()` for tests that only need a `userId` +
  `tokenVersion` pair (it writes a placeholder password hash, which is fine
  since those tests never authenticate with a password). Tests that exercise
  password verification (register/login) go through the real HTTP endpoints
  instead, so the real bcrypt hash + `bcrypt.compare` path is what's proven.
- **Auth tokens:** minted directly via the real `generateToken()` for tests
  that only need to reach `requireAuth` (matches
  `server/routes/__tests__/auth-route-wiring.test.ts`) — `requireAuth` only
  cares that the signature and DB `tokenVersion` check out, not how the
  token was produced.

## Adding a new route group

1. Add `<group>-routes.itest.ts` in this directory.
2. Mock `../../server/db` (redirect to `getTestTx()`) and `express-rate-limit`
   (pass-through) — never `storage` or `middleware/auth`.
3. Build the app with `express()` + `express.json()` + the group's real
   `register()` export, exactly like `auth-routes.itest.ts`.
4. No changes are needed to `vitest.integration.config.ts` — its `include`
   glob already covers the whole directory.
5. `.itest.ts` files share one Vitest "forks" worker per file, so module-level
   state (e.g. `tokenVersionCache` in `server/middleware/auth.ts`) persists
   across `it()` blocks in the same file — give every fixture a unique ID per
   test, the way `auth-routes.itest.ts`'s `uniqueCredentials()` does.
6. If the new group has many register/login cases, add a test-only lower
   bcrypt cost factor via an env override (prod stays at cost 12 regardless
   of the env var) to keep wall time bounded — not needed yet at current
   suite size.
