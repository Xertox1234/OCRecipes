---
title: "Wire Maestro e2e:smoke into CI so E2E flows can't rot"
status: backlog
priority: medium
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, testing, architecture]
github_issue:
---

# Wire Maestro e2e:smoke into CI so E2E flows can't rot

## Summary

There are 17 Maestro E2E flows under `e2e/flows/` but no CI job runs them, so they can silently break as the app evolves. Add a CI gate (at least the `smoke`-tagged subset) so the E2E layer stays green.

## Background

Surfaced by the 2026-05-23 testing audit. The repo has a real E2E layer (`npm run e2e` / `npm run e2e:smoke`, see `package.json`) covering auth, scan, plan, profile, and onboarding. But `.github/workflows/ci.yml` only runs the sharded Vitest suite + coverage thresholds — nothing invokes Maestro. Untested-in-CI E2E flows drift out of sync with the UI and provide false assurance.

## Acceptance Criteria

- [ ] CI runs the Maestro `smoke` subset (`npm run e2e:smoke`) on an appropriate trigger (likely a separate job/workflow, not the per-push unit gate)
- [ ] The job spins up an iOS simulator or Android emulator runner with the app build Maestro needs
- [ ] A failing flow fails the job (non-zero exit propagates)
- [ ] Decide and document cadence: every PR vs. nightly vs. pre-release (emulator jobs are slow/flaky — nightly may be the right tradeoff)

## Implementation Notes

- Flows live in `e2e/flows/` (17 yaml files); helper `e2e/helpers/login.yaml`; see `e2e/README.md`.
- Scripts already exist: `"e2e": "maestro test e2e/flows/"`, `"e2e:smoke": "maestro test --tags smoke e2e/flows/"` in `package.json`. Confirm which flows are tagged `smoke` (may need to add tags).
- Maestro needs a running device + installed app build. On GitHub Actions this means a macOS runner + iOS simulator (or an Android emulator action). This is the main cost/complexity decision — flag it before implementing.
- Keep this OUT of the fast per-push `test` gate; a flaky 10-minute emulator job blocking every push is worse than the status quo. A dedicated workflow on a schedule or `workflow_dispatch` is likely best.

## Dependencies

- Decision on CI runner type (macOS minutes cost) — needs human sign-off.

## Risks

- Emulator/simulator E2E is inherently flakier and slower than unit tests; gating every PR could create noise. Mitigate by starting with `smoke` only and/or nightly cadence.

## Updates

### 2026-05-23

- Initial creation (from testing audit).
