<!-- Filename: P3-2026-07-05-pg-external-api-cache.md -->

---

title: "PG Lab: dev-only record/replay cache for external nutrition APIs"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, server]
github_issue:

---

# PG Lab: dev-only record/replay cache for external nutrition APIs

## Summary

Add a dev-only Postgres-backed record/replay cache in front of the external nutrition APIs (CNF → USDA → API Ninjas fallback chain in `nutrition-lookup.ts`, plus Spoonacular), keyed on (api, request-hash): recorded once, replayed forever. Speeds the dev loop, dodges rate limits, and makes integration-style tests deterministic.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. External API calls in dev are slow, rate-limited, and nondeterministic. The cache lives in `ocrecipes_lab` (`dev` schema) — NOT `nutricam`, which Vitest shares — so cached fixtures never interfere with test-suite state.

## Acceptance Criteria

- [ ] `scripts/pg-lab/schema/api-cache.sql`: `dev.api_cache(api, request_hash, request_summary, response jsonb, status, recorded_at)` with unique (api, request_hash).
- [ ] A thin wrapper at the fetch boundary of `server/services/nutrition-lookup.ts` (and the Spoonacular call site) — active ONLY when `NODE_ENV=development` AND `API_CACHE=1` (opt-in env flag; default off so behavior today is unchanged).
- [ ] Modes: `API_CACHE=1` = replay-if-hit, record-on-miss. `API_CACHE=refresh` = always call through and re-record. Unset = no cache code path executes.
- [ ] Fail-silent: DB unreachable → straight passthrough to the real API, no error surfaced.
- [ ] Hard guard: wrapper throws at import time if `NODE_ENV=production` and API_CACHE is set (mirror the seed script's refuse-prod pattern).
- [ ] `scripts/pg-lab/api-cache-report.sh`: hit/miss counts per API over N days (doubles as the value probe — if hit rate is negligible by 2026-10-01, remove the wrapper).
- [ ] TDD: failing tests first for hit, miss-record, refresh, passthrough-on-no-flag, and prod-guard paths (mock pg + mock fetch).

## Implementation Notes

- Insert at the lowest shared HTTP boundary in `nutrition-lookup.ts` rather than per-provider — one wrapper, all three providers. Check how Spoonacular calls are made (`recipe-generation.ts`?) with LSP find-references on the fetch helper before deciding whether it shares the wrapper (LSP-first rule).
- request_hash = sha256 of (method, url, sorted params) — exclude API keys from the hash input so key rotation doesn't invalidate the cache.
- This is app-code-adjacent: keep the wrapper in `server/` (e.g. `server/services/dev-api-cache.ts`) so path-domain injection rules apply, but it must be tree-shakeable/inert in production builds.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` MERGED.

## Risks

- Stale fixtures masking real API contract changes — `refresh` mode + recorded_at surfaced in the report mitigate.
- Touching a core service file (`nutrition-lookup.ts`) — keep the diff to the fetch boundary only; server-reviewer should look at it.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch B).
