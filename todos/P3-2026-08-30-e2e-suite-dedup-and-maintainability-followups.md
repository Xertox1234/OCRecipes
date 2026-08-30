---
title: "E2E suite dedup: shared CI seed script, credential-entry helper, non-regression flow selector sweep"
status: backlog
priority: low
created: 2026-08-30
updated: 2026-08-30
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E suite dedup: shared CI seed script, credential-entry helper, non-regression flow selector sweep

## Summary

Three maintainability refactors deferred from the PR #880 `/code-review high`
pass (findings 9 and 10, plus a pre-existing note in that PR). None is a live
defect; all three were deliberately NOT applied pre-merge because they rewrite
surfaces that the first-ever green run (33332969400) just validated, and a
refactor invalidates that validation without buying correctness.

## Background

The `/code-review high` review of PR #880 (2026-08-30) confirmed:

1. **Workflow duplication** — the 35-line "Seed E2E test user" bash block and
   ~10 backend env vars are duplicated verbatim across the `e2e-ios` and
   `e2e-android` jobs in `.github/workflows/e2e-regression.yml`. PR #880
   itself paid the tax (added `E2E_RELAXED_RATE_LIMITS` in two places). The
   next seed-contract change (a new required register field — exactly how
   `ageConfirmed` arrived — or a renamed profile flag) risks landing in one
   job only, presenting as a platform-specific app bug.
2. **Flow-level duplication** — `complete-onboarding.yaml`'s retry loop
   re-implements the main credential-entry sequence (show-password → type →
   blur → confirm → blur → submit); the blur anchor is the literal marketing
   copy "Create an account to get started" repeated 5× in that file, and the
   Gboard stylus-dismiss block appears 3× across the file and
   `helpers/login.yaml`. One subtitle reword silently degrades all blur taps.
3. **Non-regression flows keep known-wrong selectors** — `edit-profile.yaml`
   asserts strings that don't exist on ProfileScreen (flagged in PR #880's
   body as out of scope; the regression-tagged flows were the commission).

## Acceptance Criteria

- [ ] Seed logic lives once in `scripts/ci/seed-e2e-user.sh` (repo precedent:
      `scripts/preflight.sh`), invoked by both jobs; shared backend env vars
      hoisted to workflow-level `env:`. Fail-loud behavior (REG_BODY capture,
      token-stripped failure echo, PROF_CODE check, `::error::` + exit 1) is
      preserved byte-for-byte in effect.
- [ ] The onboarding credential-entry sequence is one `runFlow` helper shared
      by the main block and the retry loop; blur uses a stable handle (add a
      `testID` to the register header rather than matching marketing copy).
- [ ] Non-regression flows (`edit-profile.yaml` first) swept against live
      hierarchy dumps per docs/solutions/best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md
      — or explicitly deleted if not worth keeping.
- [ ] One green `workflow_dispatch` run after the refactor (the whole point
      of deferring was not to invalidate a green without buying one back).

## Implementation Notes

- Files in scope: `.github/workflows/e2e-regression.yml`,
  `scripts/ci/seed-e2e-user.sh` (new), `e2e/flows/onboarding/complete-onboarding.yaml`,
  `e2e/helpers/*.yaml`, `e2e/flows/profile/edit-profile.yaml`,
  `client/screens/LoginScreen.tsx` (blur-target testID only).
- Maestro semantics traps are codified — read the four 2026-08-30
  `docs/solutions/logic-errors/maestro-*`/`ios-*` docs before touching flows
  (they now auto-inject on `e2e/**` edits).
- Local-first: iterate on the booted sim/emulator with the CI-mirror env;
  budget ONE validation dispatch at the end.

## Scope Contract

- **Mechanisms to use:** existing runFlow-helper pattern; a plain bash script
  under `scripts/ci/`; workflow-level `env:` — nothing new.
- **Files in scope:** listed above.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #880 merged first (this refactors the exact surfaces it lands).

## Risks

- The refactor invalidates the suite's CI validation until the closing
  dispatch goes green — do not interleave with other e2e work.
- `edit-profile.yaml` may reference flows/screens that changed in the
  redesign; deleting may be the right call — consult before wholesale rework.

## Updates

### 2026-08-30

- Initial creation, deferred from PR #880's `/code-review high` findings 9-10.
