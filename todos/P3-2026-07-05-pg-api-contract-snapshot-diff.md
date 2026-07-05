<!-- Filename: P3-2026-07-05-pg-api-contract-snapshot-diff.md -->

---

title: "PG Lab: API contract snapshot/diff between branches"
status: backlog
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

- [ ] `scripts/pg-lab/schema/contract-snapshots.sql`: `dev.contract_snapshots(branch, route_pattern, method, status, shape jsonb, first_seen, last_seen, sample_count)` unique on (branch, route_pattern, method, status).
- [ ] Dev-only Express middleware (opt-in via `CONTRACT_SNAPSHOT=1`, refuse-prod guard, fail-silent) that derives a type-skeleton from JSON responses: keys + primitive types + array-element skeleton, values discarded — NEVER raw values (responses contain user health data; storing values is out of bounds).
- [ ] Route identity uses the Express route pattern (`req.route.path` with params as placeholders), not the concrete URL.
- [ ] `scripts/pg-lab/contract-diff.sh <branch> [base=main]`: added/removed routes, added/removed/retyped keys per route; exit 1 on differences (usable as a manual pre-PR check; NOT wired into preflight).
- [ ] Value probe: run it across one real feature-branch cycle; record in Updates whether it caught anything tests didn't.
- [ ] TDD: shape-derivation unit tests (nested objects, arrays, nulls, mixed-type arrays), middleware opt-in/prod-guard tests, diff logic tests.

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
