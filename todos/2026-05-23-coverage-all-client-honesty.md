---
title: "Enable coverage.all to expose true client-side coverage"
status: backlog
priority: low
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, testing]
github_issue:
---

# Enable coverage.all to expose true client-side coverage

## Summary

v8 coverage currently only reports files that a test imports, so untested client files vanish from the denominator and inflate the headline number. Turn on `coverage.all` (or an explicit `coverage.include`) to get an honest picture, then decide where to invest.

## Background

Surfaced by the 2026-05-23 testing audit. A full coverage run reported **84.1% lines / 74.2% branches** total — but only **193 of ~391 client source files** were even imported during the run (server was fully measured). The ~200 client files no test touches (mostly screens + presentational components) are not counted as 0%; they're simply absent. So the 84% is "84% of exercised files," not of the codebase, and it masks how thin client coverage really is.

## Acceptance Criteria

- [ ] `vitest.config.ts` sets `coverage.all: true` (and an appropriate `coverage.include` glob for `client/`, `server/`, `shared/`) so unimported source files count as 0%
- [ ] A fresh `npm run test:coverage` shows the new (lower) honest totals
- [ ] Re-baseline the CI thresholds in `vitest.config.ts` against the new numbers — set the floor just below the new measured baseline (matching the existing ratcheting convention in the config comment), do NOT keep the old floors that assumed the inflated denominator
- [ ] Document the new baseline in the config comment (currently references the 2026-05-15 numbers)

## Implementation Notes

- File: `vitest.config.ts` → `test.coverage` block (currently has `exclude` but no `include`/`all`).
- Beware: flipping `all: true` without an `include` will try to instrument everything (configs, mocks, type-only files). Add a focused `include` like `["client/**/*.{ts,tsx}", "server/**/*.ts", "shared/**/*.ts"]` and keep the existing `exclude` (tests, mocks, `server_dist`).
- Expect the headline to drop substantially (client tree is ~half-measured). That's the point — the thresholds must be re-baselined in the SAME change or CI will fail. See the `thresholds` comment in the config for the ratcheting rule.
- This is a measurement-honesty change, not a coverage-raising change. Raising client coverage is separate follow-up work informed by the new report.

## Dependencies

- None.

## Risks

- If thresholds aren't re-baselined in the same PR, the coverage CI job breaks. Do both together.

## Updates

### 2026-05-23

- Initial creation (from testing audit).
