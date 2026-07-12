<!-- Filename: P3-2026-07-09-e2e-regression-gating-maestro.md -->

---

title: "Promote Maestro E2E from workflow_dispatch smoke to scheduled/PR-gated regression"
status: done
priority: low
created: 2026-07-09
updated: 2026-07-11
assignee:
labels: [deferred, testing, e2e]
github_issue:

---

# Promote Maestro E2E from workflow_dispatch smoke to scheduled/PR-gated regression

## Summary

`.github/workflows/e2e-smoke.yml` runs Maestro E2E flows only on manual `workflow_dispatch` — it
is not a regression suite. Promote it to a scheduled or PR-gated run covering the top critical
flows, on both iOS and Android.

## Background

Split out of `P3-2026-06-27-broader-test-quality-non-mutation.md` (archived) so this initiative
can be scheduled independently. Critical flows (login → onboarding → scan → log; coach chat;
meal plan) currently have no automated end-to-end coverage gating merges — a regression in any
of them ships silently unless caught manually.

## Acceptance Criteria

- [x] Inventory the critical flows `e2e-smoke.yml` currently covers vs. the target list (login →
      onboarding → scan → log; coach chat; meal plan) and note gaps.
- [x] Decide the trigger: scheduled (e.g. nightly) vs. PR-gated (blocking required check) vs.
      both — document the tradeoff (PR-gated catches regressions before merge but adds latency
      and flakiness risk to the required-check path; scheduled catches regressions after merge
      but doesn't block them).
- [x] Update `.github/workflows/e2e-smoke.yml` (or a new workflow) to run on the chosen trigger,
      covering both iOS and Android.
- [x] If gating PRs, keep this suite separate from the fast `preflight` required-check path so a
      flaky E2E run doesn't block unrelated merges without a clear, actionable failure signal.

## Implementation Notes

- Workflow file: `.github/workflows/e2e-smoke.yml`.
- This is a design task, not a mechanical split — expect to make real decisions about trigger
  strategy and flake tolerance (retries, quarantine) before changing the gating behavior.

## Dependencies

- None hard.

## Risks

- E2E tests are inherently slower and flakier than unit/integration tests. Gating merges on a
  flaky suite erodes trust in required checks — consider a scheduled run first, with PR-gating as
  a later step once flake rate is proven low.

## See Also

- `todos/archive/P3-2026-06-27-broader-test-quality-non-mutation.md` — the umbrella this was
  split from.

## Updates

### 2026-07-11

- Implemented. Trigger decision: **scheduled nightly (08:17 UTC) + retained `workflow_dispatch`;
  NOT PR-gated.** Rationale: the suite has never been validated on a runner, E2E is inherently
  flaky, and gating merges on an unproven suite erodes required-check trust (per this todo's
  Risks section). The repo is public, so standard GitHub-hosted runners — including macOS — are
  free; the old "paid macOS minutes" rationale for manual-only no longer applies. PR-gating is
  documented as a deliberate later step once the nightly flake rate is proven low, and if adopted
  must stay a separate check off the fast preflight required-check path.
- Coverage: new `regression` Maestro tag on the 8 critical flows (login, onboarding,
  navigate-tabs, scan-barcode, photo-analysis, view-item-detail, chat, meal-plan-home) + new
  `npm run e2e:regression` script. Inventory table with gaps (camera capture untestable in CI;
  no camera-free food-log flow; chat response unasserted with stubbed AI key) in
  `e2e/README.md` → CI.
- Android coverage added: `e2e-android` job on `ubuntu-latest` (KVM +
  `reactivecircus/android-emulator-runner@v2`, Postgres service container mirroring `ci.yml`,
  `adb reverse` so the app's `localhost` fallback reaches host Metro/backend). Both jobs also
  gained a background Metro step — the debug dev-client loads JS from Metro, without which no
  flow can render. Flake tolerance: one in-job retry of the Maestro step.
- Review round 1: workflow file renamed `e2e-smoke.yml` → `e2e-regression.yml` (matches the
  workflow name; the todo allowed "or a new workflow"). Two stale flows fixed against the
  current tab bar (Home/Plan/Coach/Profile + Scan FAB — there is no History or Scan tab):
  `home/navigate-tabs.yaml` now taps Plan/Coach/Profile and asserts the Scan FAB present;
  `home/view-item-detail.yaml` reaches history via Profile → Scan History. Coverage table
  corrected to match.

### 2026-07-09

- Split from the `P3-2026-06-27-broader-test-quality-non-mutation.md` umbrella at user request,
  scoped to the E2E acceptance criterion only.
