<!-- Filename: P3-2026-07-09-e2e-regression-gating-maestro.md -->

---

title: "Promote Maestro E2E from workflow_dispatch smoke to scheduled/PR-gated regression"
status: backlog
priority: low
created: 2026-07-09
updated: 2026-07-09
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

- [ ] Inventory the critical flows `e2e-smoke.yml` currently covers vs. the target list (login →
      onboarding → scan → log; coach chat; meal plan) and note gaps.
- [ ] Decide the trigger: scheduled (e.g. nightly) vs. PR-gated (blocking required check) vs.
      both — document the tradeoff (PR-gated catches regressions before merge but adds latency
      and flakiness risk to the required-check path; scheduled catches regressions after merge
      but doesn't block them).
- [ ] Update `.github/workflows/e2e-smoke.yml` (or a new workflow) to run on the chosen trigger,
      covering both iOS and Android.
- [ ] If gating PRs, keep this suite separate from the fast `preflight` required-check path so a
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

### 2026-07-09

- Split from the `P3-2026-06-27-broader-test-quality-non-mutation.md` umbrella at user request,
  scoped to the E2E acceptance criterion only.
