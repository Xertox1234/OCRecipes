<!-- Filename: P3-2026-07-05-pg-api-contract-snapshot-diff.md -->

---

title: "PG Lab: API contract snapshot/diff between branches"
status: done
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, server]
github_issue:

---

# PG Lab: API contract snapshot/diff between branches

## Summary

Record dev-mode Express response _shapes_ (route, method, status, JSON key-structure skeleton) into `dev.contract_snapshots` per branch, and ship a diff script that compares a feature branch's shapes against main's — catching accidental API contract changes before a PR.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. The auth memory (project_auth_recurring_breakage) documents the wiring gap: route tests mock the middleware, so contract-level regressions slip through. Shape-diffing actual dev-traffic responses is a cheap independent net. Mobile clients make silent contract drift expensive (OTA'd clients hit stale-shape crashes).

## Acceptance Criteria

- [x] `scripts/pg-lab/schema/contract-snapshots.sql`: `dev.contract_snapshots(branch, route_pattern, method, status, shape jsonb, first_seen, last_seen, sample_count)` unique on (branch, route_pattern, method, status).
- [x] Dev-only Express middleware (opt-in via `CONTRACT_SNAPSHOT=1`, refuse-prod guard, fail-silent) that derives a type-skeleton from JSON responses: keys + primitive types + array-element skeleton, values discarded — NEVER raw values (responses contain user health data; storing values is out of bounds).
- [x] Route identity uses the Express route pattern (`req.route.path` with params as placeholders), not the concrete URL.
- [x] `scripts/pg-lab/contract-diff.sh <branch> [base=main]`: added/removed routes, added/removed/retyped keys per route; exit 1 on differences (usable as a manual pre-PR check; NOT wired into preflight).
- [x] Value probe: run it across one real feature-branch cycle; record in Updates whether it caught anything tests didn't.
- [x] TDD: shape-derivation unit tests (nested objects, arrays, nulls, mixed-type arrays), middleware opt-in/prod-guard tests, diff logic tests.

## Implementation Notes

- Middleware wraps `res.json` — register it early in `server/index.ts` dev-only setup, keyed on current git branch (read once at boot).
- Shape derivation must be deterministic (sorted keys) so jsonb equality works for dedup; bump sample_count/last_seen on identical shapes.
- Health-data rule: this todo stores structure only. Do not let "just log one example value" creep in during implementation — flag it in review if it does. Never delegate this file to kimi scripts (user global rule: no cheap workers near user health data).

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Coverage is only as good as dev traffic exercised on each branch — the diff must print per-branch sample counts so "no diff" isn't confused with "no data."
- `res.json` wrapping interacting with error handlers/streaming endpoints — wrap defensively, passthrough on anything non-JSON.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch C).
- Implemented: `scripts/pg-lab/schema/contract-snapshots.sql`, `server/lib/contract-shape.ts`
  (pure `deriveShape`/`diffRouteShapes`, Vitest-covered), `server/lib/contract-snapshot.ts`
  (the opt-in Express middleware, lazily-constructed lab-DB `Pool` per the lazy-init
  convention since a test file imports it), `scripts/pg-lab/contract-diff-cli.ts` (thin
  CLI over the pure diff logic) + `scripts/pg-lab/contract-diff.sh` (bash wrapper, mirrors
  `codify-neardup.sh`'s `LAB_DATABASE_URL`/denylist/loud-failure conventions), one-line wire-up
  in `server/index.ts`, and `.claude/hooks/test-pg-lab-contract-diff.sh` (full round-trip
  integration test, shellcheck-clean, skips cleanly with no local Postgres).
- Value probe executed against real traffic: started the dev server on this branch with
  `CONTRACT_SNAPSHOT=1` against the real local `ocrecipes_lab` DB, hit `/api/health` (GET 200) and a deliberately-wrong-body `/api/auth/login` (POST 400) a few times, and hit a
  genuine 404 to confirm it is correctly skipped (no `req.route` match). Findings:
  - `sample_count` bumped correctly on repeated identical shapes (3 `/api/health` hits →
    `sample_count=3`) — the dedup logic works against live traffic, not just fixtures.
  - Diffing the captured feature-branch rows against `main` (which had zero recorded rows,
    since main was never run with the middleware) correctly printed `SAMPLES: base=0
feature=4` with an explicit "zero recorded traffic" warning and exited 1 — confirming
    the Risks-section concern (don't confuse "no diff" with "no data") is actually caught,
    not just asserted in a unit test.
  - Seeding a synthetic `main` baseline with the _same_ shapes as the real captures
    correctly reported "no differences" (exit 0) — no false positive on genuinely unchanged
    routes, which is the common case since this todo doesn't alter any existing route's
    response contract.
  - Perturbing that baseline (removing the `code` field from the login-400 shape) was
    correctly detected as an added key on the real DB round-trip (not just the unit-test
    fixtures) — confirms the mechanism catches a real contract change end-to-end.
  - Did it catch anything tests didn't? Not a genuine regression (none exists on this
    branch), but it did surface one real design question tests can't: the "no data" vs
    "no diff" distinction only actually gets exercised against live traffic shape, and the
    live run confirmed the wording/exit-code behavior chosen for that case is correct. All
    probe rows were deleted from the shared `ocrecipes_lab` DB after the run.
- Code review (2 rounds, `code-reviewer` + `server-reviewer` + `security-auditor`):
  - Round 1 CRITICAL (security-auditor, empirically confirmed): the `LAB_DATABASE_URL`
    denylist in `server/lib/contract-snapshot.ts`'s `getLabPool()` and
    `scripts/pg-lab/contract-diff.sh` parsed the database name via naive string-slicing
    (`lastIndexOf("/")` / `##*/`), which left a trailing query string attached (e.g.
    `?sslmode=require`) and silently bypassed the exact-match `nutricam`/
    `ocrecipes_solutions` refusal. Fixed: `parseDbName()` now uses `new URL(...).pathname`
    (with a fallback for a URL the parser rejects), plus a `SAFE_IDENTIFIER_RE` check
    added after the denylist for defense-in-depth, matching `scripts/pg-lab/init.sh`'s
    existing pattern; the bash script strips the query string before the `##*/`
    extraction. `getLabPool` was exported for direct unit testing.
  - Round 1 WARNING (code-reviewer, empirically confirmed): `contract-diff-cli.ts`'s
    `buildDiffReport` used two DIFFERENT route-identity granularities — `routeKey`
    (method+route_pattern) for added/removed routes vs `fullKey` (+status) for the
    key-diff lookup — so a route whose STATUS CODE changed between branches (same
    route/method, different status) was silently reported as "no differences" instead of
    a real contract change. Fixed by consolidating to one status-inclusive `routeKey`
    used everywhere, with a dedicated regression test.
  - Round 1 WARNING (code-reviewer + security-auditor): `buildDiffReport`/`formatReport`
    and the denylist itself had no direct Vitest coverage. Fixed: added
    `scripts/pg-lab/__tests__/contract-diff-cli.test.ts` (11 tests) and a
    `getLabPool (lab-DB denylist)` describe block in `contract-snapshot.test.ts` (5 tests,
    using `vi.resetModules()` + dynamic import per the project's env-dependent-module
    convention).
  - Round 1 SUGGESTION (security-auditor): `deriveShape` stores object key NAMES verbatim
    (only values are discarded) — no current route returns a dynamically-keyed response
    object, but flagged as a footgun for a future one. Addressed with a doc-comment
    caveat on `deriveShape`.
  - Round 1 SUGGESTION (code-reviewer): unvalidated `JSON.parse` cast on stdin in
    `contract-diff-cli.ts`'s `main()`. Addressed with a minimal `Array.isArray` shape
    guard on `base`/`feature`.
  - Round 2: both reviewers confirmed the round-1 fixes actually close the gaps
    (empirically re-traced, including ~15 adversarial `LAB_DATABASE_URL` variants by
    security-auditor). Two new round-2 WARNINGs, both fixed without a third review round
    (test-only additions, no production-code risk): `formatReport`'s "KEY DIFFS:"
    rendering branch had zero test coverage (added a test), and the percent-encoding
    bypass class (`nutr%69cam` decodes to the literal `nutricam` for a real Postgres
    connection, currently blocked only incidentally by `SAFE_IDENTIFIER_RE` rejecting the
    un-decoded `%`) had no explicit regression test (added one, TS + bash).
  - **DEFERRED (out of scope of this todo's diff):** security-auditor's round-2 CRITICAL
    finding that the identical `LAB_DATABASE_URL` query-string denylist bypass is still
    live in `scripts/pg-lab/codify-neardup.sh` — a different, already-merged PG Lab item's
    script, not touched by this diff. Not fixed here (would exceed this todo's Acceptance
    Criteria and blast radius); surfaced to the orchestrator/user for a decision on a
    follow-up fix.
  - Remaining SUGGESTION, not applied (non-trivial for a SUGGESTION-tier finding):
    per-row field validation of `DiffInput` (a named `isDiffInput` type guard checking
    each row's field types) — current validation only checks `base`/`feature` are arrays.
    Low risk since the input is DB-controlled via a fixed `SELECT`, not user input.
