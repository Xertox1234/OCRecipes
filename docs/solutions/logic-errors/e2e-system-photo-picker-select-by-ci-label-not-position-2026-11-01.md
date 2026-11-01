---
title: 'E2E system photo pickers: select by the labels in the CI dump, not by screen position measured locally, and never change the shared test account for one flow'
track: bug
category: logic-errors
module: e2e
tags: [testing, maestro, e2e, react-native]
applies_to: [e2e/flows/**/*.yaml, e2e/helpers/*.yaml, scripts/ci/seed-e2e-user.sh, .github/workflows/e2e-regression.yml]
symptoms: [Picker taps by point select nothing on CI but work on a local simulator, A regex like "Photo.*" taps the picker's Photos tab instead of a photo, Unrelated flows fail on both platforms after a seed change for one flow]
severity: medium
created: '2026-11-01'
---

# E2E system photo pickers: pick by CI label, keep the shared account unchanged

Harness N6, part B (#1679). The first CI run of the new receipt-upload flow was red on both
platforms, and no photo was sent in any job. There were three causes, none of them in the app.

## What went wrong

1. **iOS, taps by position.** On a local simulator the out-of-process PHPicker looked invisible to
   Maestro, so the flow tapped the first cell and the ✓ by screen position. A fresh CI simulator
   shows a "Private Access to Photos" banner that pushes the grid down, so both taps missed. The
   CI hierarchy dump shows that CI's picker **is** readable: each cell is labelled
   `Photo, November 01, 6:59 PM` and the ✓ is `Done`.
2. **Android, a regex that was too loose.** `Photo.*` at index 0 matched the picker's **"Photos"
   tab** before the photo cell (`Photo taken on Nov 1, 2026, 7:19:30 PM`), so nothing was selected
   and the "Add" button never appeared.
3. **Changing the shared account.** Making `testuser` premium so the flow could reach the
   premium-only receipt scanner also changed the Coach tab's first screen to Coach Pro
   (`client/navigation/coachInitialRoute.ts`). Every flow signs in as `testuser`, so the chat and
   tab flows lost their "NutriCoach" heading on both platforms.

## Fix

- Take selectors from the **CI run's** `screen-hierarchy/*.json` (in the logs artifacts), not from
  a local simulator. Maestro text matching is a full-string regex, which narrows things further:
  iOS leaves the year off this year's photos, so `'Photo, \w+ \d{2}, \d{1,2}:\d{2}.[AP]M'` matches
  only the photo `addMedia` just added. It does not match the 2009–2018 stock photos, or the grid,
  whose label joins every cell's. The `.` is there because iOS puts a narrow no-break space before
  AM/PM. On Android use `Photo taken on .*`, then `Add.*`.
- A flow that needs a different account state gets **its own seeded account**. Here that is
  `e2epremium`, seeded with `PREMIUM=1 bash scripts/ci/seed-e2e-user.sh`. The flow runs
  `ensure-logged-out` before signing in, and its `onFlowComplete` (launch-app, then
  ensure-logged-out) runs pass or fail, so the flows after it sign in as the shared account again.
- When a flow is meant to prove that a request arrived, log the request on the server side (here,
  `scripts/ci/stub-openai.log`). A red flow by itself can't tell "the upload broke" from "the flow
  never got to the upload". The log can: 0 requests in every job of this first run, 1 per platform
  once the flow was fixed, and 0 on the control branch that had the pre-#1592 upload code.

## How to spot it

A flow that passes locally and fails on CI at a system-UI step: open the CI failure screenshot
**and** that step's hierarchy dump before changing anything else. A seed change for one flow
followed by new failures in flows that never touch that feature means the shared account carried
the change.
