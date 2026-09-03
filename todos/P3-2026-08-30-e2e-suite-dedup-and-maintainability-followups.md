---
title: "E2E suite dedup: shared CI seed script, credential-entry helper, non-regression flow selector sweep"
status: review
priority: low
created: 2026-08-30
updated: 2026-09-01
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

- [x] Seed logic lives once in `scripts/ci/seed-e2e-user.sh` (repo precedent:
      `scripts/preflight.sh`), invoked by both jobs; shared backend env vars
      hoisted to workflow-level `env:`. Fail-loud behavior (REG_BODY capture,
      token-stripped failure echo, PROF_CODE check, `::error::` + exit 1) is
      preserved byte-for-byte in effect.
- [x] The onboarding credential-entry sequence is one `runFlow` helper shared
      by the main block and the retry loop; blur uses a stable handle (add a
      `testID` to the register header rather than matching marketing copy).
- [ ] Non-regression flows (`edit-profile.yaml` first) swept against live
      hierarchy dumps per docs/solutions/best-practices/diagnose-e2e-from-debug-output-artifacts-first-2026-08-30.md
      — or explicitly deleted if not worth keeping. NOT MET — see 2026-09-01
      Updates entry for the static findings gathered instead and why a live
      dump wasn't produced this run.
- [ ] One green `workflow_dispatch` run after the refactor (the whole point
      of deferring was not to invalidate a green without buying one back).
      NOT MET — requires a human-triggered dispatch after this PR's branch
      exists on origin; see 2026-09-01 Updates entry for the exact command.

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

### 2026-09-01 — items 1-2 implemented; items 3-4 need a human follow-up

Items 1 and 2 are implemented and committed on branch
`todo/P3-2026-08-30-e2e-suite-dedup-and-maintainability-followups`:

- `scripts/ci/seed-e2e-user.sh` (new) holds the seed logic once; both jobs
  call it. The ~10 shared backend/credential env vars are hoisted to a
  workflow-level `env:` in `.github/workflows/e2e-regression.yml`; the iOS
  job keeps only its two iOS-specific vars
  (`MAESTRO_DRIVER_STARTUP_TIMEOUT`, `SENTRY_ALLOW_FAILURE`), and the
  Android job's `env:` block is now empty and removed. Fail-loud contract
  (REG_BODY capture, token-stripped error echo, PROF_CODE check,
  `::error::` + exit 1) is unchanged; the only behavioral delta is the
  script's `set -uo pipefail` (no `-e`) vs. the workflow step's implicit
  `bash -eo pipefail` — a curl _transport_ failure now falls through to the
  existing `if [ -z "$TOKEN" ]` / `PROF_CODE != 200` branches and exits 1
  with a message, instead of aborting opaquely. That's a strengthening of
  the fail-loud contract, not drift from it.
- `e2e/helpers/enter-registration-passwords.yaml` (new) is the shared
  `runFlow` helper for the password + confirm-password sequence
  (show-password → type → blur → confirm → blur), used by both
  `complete-onboarding.yaml`'s main block and its own retry loop. Blur now
  targets `testID="auth-form-subtitle"` added to `LoginScreen.tsx`'s header
  subtitle (`client/screens/LoginScreen.tsx`, testID only, no other change)
  instead of matching the marketing copy "Create an account to get
  started" (5 occurrences before this change). Added a mandatory
  `assertVisible: { id: "input-password" }` right before the main block's
  call into the (fully-optional) shared helper, so a renamed/removed field
  still fails fast instead of degrading silently through 3 retry rounds —
  see `docs/solutions/logic-errors/optional-e2e-steps-cannot-fail-dead-selectors-stay-green-2026-08-30.md`.
  `scripts/preflight.sh --fast --uncommitted` passed (incl. the related
  `LoginScreen` test); `maestro check-syntax` passed on both flow files
  (note: check-syntax does NOT validate that a `runFlow` file reference
  resolves — verified separately that `e2e/flows/onboarding/../../helpers/enter-registration-passwords.yaml`
  resolves to the new file, matching the two other `../../helpers/*.yaml`
  references already proven working in this same file).

**Item 3 (edit-profile.yaml sweep) — NOT MET, static findings only, file
left untouched.** A live-hierarchy-dump sweep (the todo's own prescribed
method) wasn't produced this run — no booted simulator/backend in this
worktree, and per this repo's own `diagnose-e2e-from-debug-output-artifacts-first`
rule, a source-read-only selector rewrite is the smell pattern that doc
warns against, not the fix. Static evidence gathered instead:

- `e2e/flows/profile/edit-profile.yaml` is tagged `[profile]` only — no
  `regression` or `smoke` tag — so it is excluded from both
  `npm run e2e:regression` and `npm run e2e:smoke` and currently never runs
  in CI at all. This also means the closing `workflow_dispatch` (item 4)
  cannot validate a fix to this file even after one is written.
- Of its four `assertVisible` strings after landing on "Profile": "Dietary
  Profile" and "Save Changes" DO exist (`client/components/profile/InlineSettings.tsx`,
  `client/screens/EditDietaryProfileScreen.tsx`). "Weight Tracking" exists
  NOWHERE in `client/` (grepped the whole tree). "Nutrition Goals" and
  "Sign Out" exist, but on `client/screens/SettingsScreen.tsx`'s settings
  list — a screen this flow never navigates to (it taps "Profile" once and
  asserts all four strings visible on the resulting screen, but
  `client/screens/ProfileScreen.tsx` renders `ProfileCard`/`MiniWidgetRow`/`LibraryGrid`/`InlineSettings`,
  not a settings list).
- Recommendation for the human decision this needs: this flow reads as
  stale/orphaned (untagged for any CI run, mixes assertions from two
  different screens, references a section that doesn't exist anywhere) —
  a strong candidate for deletion, but confirm with a live hierarchy dump
  first per the cited solution rather than deleting on this static read
  alone.

**Item 4 (one green `workflow_dispatch`) — NOT MET, needs a human trigger.**
The dispatch can only run after this branch is pushed (Step 10, after this
entry), the iOS job alone has a measured realistic path of ~60m
(`timeout-minutes: 160`), and the prior todo in this same file's history
(`todos/archive/P2-2026-08-30-e2e-flow-assertions-dont-match-app-ui.md`)
needed 17 dispatches and three hardening PRs to reach one green — a single
run here would be ambiguous between "this refactor" and shared-macOS-runner
contention, which that history shows recurs independent of any code change.
Also: the `low`-priority automerge guard will HOLD this PR on its PATH gate
(`.github/` and `scripts/` are both denylisted paths), so it already goes to
individual human review regardless — that reviewer is who should run:

```
gh workflow run e2e-regression.yml --ref todo/P3-2026-08-30-e2e-suite-dedup-and-maintainability-followups
```

**Status left at `review`, not `done`, and this file is intentionally NOT
archived** — items 3 and 4 are unmet, and archiving as done here would be
exactly the "partial fix reported as done gets re-litigated later" failure
mode the parent E2E-commissioning history already paid for once. Once a
human confirms item 3 (fix or delete `edit-profile.yaml`) and item 4 (a
green `workflow_dispatch` on this branch, or on `main` after merge), flip
`status: done` and move this file to `todos/archive/`.
