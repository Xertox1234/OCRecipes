---
title: "E2E: Android nightly fails the NutriCoach chat flow at the login check"
status: backlog
priority: medium
created: 2026-10-27
updated: 2026-10-27
assignee:
labels: [deferred, testing]
github_issue:
---

# E2E: Android nightly fails the NutriCoach chat flow at the login check

## Summary

On the Android emulator, `e2e/flows/home/chat.yaml` ("Home - NutriCoach chat
interaction") has failed in the nightly `e2e-regression.yml` on 2026-10-24,
10-26 and 10-27 with `Assertion is false: "(Sign In|Hello.*|Not Now)" is visible`.
It keeps the nightly red after the edit-profile fix (#1582).

## Background

Found while checking whether #1582 turned the nightly green. Android flow
failures per night (from `gh run view <id> --log-failed`):

- 10-23: edit-profile only
- 10-24, 10-26, 10-27: edit-profile + chat
- 10-25: no flow failures logged on Android

The failing assertion is a login/landing check, not a chat assertion, so the app
probably lands on a screen none of the three alternatives match (a paywall sheet,
a new prompt, or a slow first render). The start lines up with the SDK upgrade
merges (step 2 #1546 merged around 10-23/24).

## Acceptance Criteria

- [ ] Root cause identified from the run's Maestro artifacts (screenshot at the failed step), not guessed.
- [ ] `chat.yaml` (or the shared helper holding the assertion) passes on the Android nightly for 3 nights in a row.
- [ ] iOS behaviour of the same flow unchanged once the iOS nightly builds again.

## Implementation Notes

- Find which file holds `(Sign In|Hello.*|Not Now)`: `grep -rn 'Not Now' e2e/`.
- Pull the failing run's uploaded Maestro artifacts (`gh run download <id>`) and read the screenshot taken at failure.
- There is no Android device locally; validate via `workflow_dispatch` of `e2e-regression.yml`.

## Scope Contract

- **Mechanisms to use:** existing Maestro helpers in `e2e/helpers/`.
- **Files in scope:** `e2e/flows/**`, `e2e/helpers/**`.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-10-27

- Initial creation (found while checking the nightly after #1582).
