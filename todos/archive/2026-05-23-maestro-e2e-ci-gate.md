---
title: "Wire Maestro e2e:smoke into CI so E2E flows can't rot"
status: done
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

> **Scope decision (2026-05-23):** Trigger is `workflow_dispatch` only (manual, on-demand). No schedule/nightly and no push/pull_request trigger — keeps paid macOS-runner minutes confined to deliberate manual runs. No production deployment yet; revisit cadence pre-launch.

- [ ] A dedicated workflow (e.g. `.github/workflows/e2e-smoke.yml`) triggers on `workflow_dispatch` only — not on push, pull_request, or schedule
- [ ] The job provisions the runner Maestro needs (macOS runner + iOS simulator, or Android emulator on a Linux runner) and installs the app build / Maestro CLI
- [ ] The job runs `npm run e2e:smoke`; a failing flow fails the job (non-zero exit propagates)
- [ ] Confirm which flows are tagged `smoke` (add `tags: smoke` to the relevant `e2e/flows/*.yaml` if none are tagged yet) so `e2e:smoke` selects a real subset
- [ ] The workflow documents (comment header + a line in `e2e/README.md`) that it is manual-trigger-only by design, for cost reasons

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
- Scope narrowed to `workflow_dispatch`-only (manual) per maintainer decision — no schedule/push/PR trigger, to keep paid macOS-runner minutes confined to deliberate runs. Acceptance Criteria rewritten accordingly.
- Implemented `.github/workflows/e2e-smoke.yml` (manual trigger, macOS-14 runner, iOS simulator, Postgres + backend startup, `npm run e2e:smoke`). Three flows already tagged `smoke` (auth/login, home/navigate-tabs, onboarding/complete-onboarding) — no new tags needed. Documented manual-only intent in workflow header + `e2e/README.md`. Real end-to-end validation requires a manual `workflow_dispatch` run by the maintainer (cannot run from a worktree).
