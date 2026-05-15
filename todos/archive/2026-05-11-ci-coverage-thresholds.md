---
title: "Add coverage threshold gate to CI"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [testing, ci, deferred, audit-2026-05-11]
github_issue:
---

# Add coverage threshold gate to CI

## Summary

`vitest.config.ts` defines a `coverage` reporter block but no `thresholds`. `.github/workflows/ci.yml` runs `npm run test:run` without `--coverage`. Coverage can regress silently. Add a baseline threshold (e.g., 70% lines/functions, ratcheted up over time) and run with `--coverage` in CI.

## Background

Surfaced by audit 2026-05-11 (finding L2 in `docs/audits/2026-05-11-testing.md`). The project ships a paid B2B API surface where uncovered regressions have customer impact, so a coverage floor is more valuable here than in a typical app.

## Acceptance Criteria

- [ ] `vitest.config.ts` adds `coverage.thresholds: { lines: N, functions: N, branches: N }` with N set to current baseline (run locally first to capture baseline)
- [ ] `package.json` adds a `test:coverage:ci` script that runs vitest with `--coverage --coverage.thresholds.autoUpdate=false`
- [ ] `.github/workflows/ci.yml` either replaces `npm run test:run` with the coverage script, or adds a new step
- [ ] Decide threshold strategy: hard floor (fail CI if below) vs informational (`reporter: ["text-summary"]` only)
- [ ] Document in `docs/patterns/testing.md`: how to update thresholds when coverage genuinely improves

## Implementation Notes

- Vitest's `coverage.thresholds.autoUpdate: true` is convenient but defeats the purpose — set false in CI
- Per-directory thresholds (`coverage.thresholds.perFile`) can be too noisy; prefer global thresholds
- Excluded paths: keep `**/*.test.ts`, `server_dist`, `node_modules`; consider excluding `client/screens/*Screen.tsx` (UI shells) and `client/components/*.tsx` that don't have testable utils

## Dependencies

None.

## Risks

- Threshold gates can become drag if set too tight too soon; start at current baseline and ratchet up gradually.
