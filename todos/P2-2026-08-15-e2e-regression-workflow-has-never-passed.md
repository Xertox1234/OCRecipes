---
title: "E2E Regression has never passed — 34/34 nightly runs failed, so the suite has produced zero signal since it landed"
status: in-progress
priority: medium
created: 2026-08-15
updated: 2026-08-15
assignee:
labels: [ci, e2e, maestro, harness, android, ios]
github_issue:
---

# The nightly E2E suite has never once run

## Summary

`.github/workflows/e2e-regression.yml` has failed **every run in its entire retained
history — 34 of 34, 2026-07-13 through 2026-08-15, zero successes.** No Maestro flow has
ever executed on either job. The repo has believed it had nightly E2E regression coverage for
a month and has had none. The two jobs fail for entirely different reasons — the iOS job at
its first infrastructure step, the Android job one line from the finish.

## Background

This is **not a product regression.** Neither job has ever reached the flows, so nothing
here says anything about app behaviour. It is a commissioning failure: the workflow landed,
never worked, and nobody saw it.

Why nobody saw it is the structural half of the problem, and it is by design:

- It is `schedule`-only (`cron: "17 8 * * *"`) plus `workflow_dispatch`. It never runs on a
  PR.
- Its header states it is **intentionally not in the branch-protection required-check
  list**, so a red run never blocks a merge — a deliberate and defensible call, made in
  `todos/archive/P3-2026-07-09-e2e-regression-gating-maestro.md`.
- The header also says failures "surface on the Actions tab (and via GitHub's
  scheduled-workflow failure notifications)." Empirically, 34 consecutive failures did not
  surface to anyone.

The header even anticipated this: _"expect the first scheduled/dispatched runs to need one
or two iterations to settle the native builds and simulator/emulator boot on the runners."_
Those iterations never happened, and nothing was watching to prompt them.

## The two failures (verified 2026-08-15, run 31874413569)

Both the oldest retained run (2026-07-13) and the newest (2026-08-15) fail identically, so
these are original defects, not drift.

### iOS job — `runs-on: macos-14`, step `Start Postgres` (`.github/workflows/e2e-regression.yml:86-96`)

```
##[error]Formula `postgresql@14` is not installed.
##[error]Formula `postgresql@18` is not installed.
##[error]Process completed with exit code 1.
```

The step is `brew services start postgresql@14 || brew services start postgresql`. Neither
the pinned version nor the bare fallback (which resolves to `postgresql@18`) exists on the
runner image. The step's own comment — _"macOS runners ship Postgres but leave it
stopped"_ — is a false premise, and was false when it was written.

This job dies at the **first infrastructure step**. It has never built the app, booted a
simulator, or started Metro (the log upload reports `No files were found ... server.log,
metro.log`). Fixing Postgres will reveal the next layer, not finish the job.

### Android job — `runs-on: ubuntu-latest`, step `Build app and run Maestro regression flows`

**Corrected 2026-08-15 — the original diagnosis in this todo was wrong.** It read
`ERROR | Unable to connect to adb daemon on port: 5037` as the root cause and concluded "the
emulator never becomes usable". That line is benign cold-start chatter, emitted at `08:27:00`
— before the build even starts. `npx expo run:android --no-bundler` is invoked at `08:27:36`,
reports `BUILD SUCCESSFUL in 16m 41s` at `08:44:19`, and the app launches one second later at
`08:44:20` (`› Opening exp+ocrecipes://… on test`). The emulator is fine.

The job clears everything — checkout, deps, `pg_trgm`, schema push, Maestro install, KVM
perms, backend, Metro, emulator boot, native build, install, deep-link launch — and then dies
at `08:44:24` invoking the test command:

```
[command]/usr/bin/sh -c npm run e2e:regression || {
/usr/bin/sh: 1: Syntax error: end of file unexpected (expecting "}")
##[error]The process '/usr/bin/sh' failed with exit code 2
```

`reactivecircus/android-emulator-runner@v2` runs the `script:` block **one line per `sh -c`
invocation** — the log shows a separate `[command]/usr/bin/sh -c <line>` for each. The last
line is therefore handed to a shell on its own, opens a brace group, and hits EOF. That is also
why the "built-in single retry" never actually retried anything: the retry body lives on lines
that shell never saw.

**This constrains the fix.** No amount of quoting _inside_ the block helps — a multi-line
construct cannot survive per-line execution. The retry must collapse onto a single line, or
move out of `script:` into its own `run:` step.

**A workflow-authoring bug, not an environment or emulator problem.**
Verify against run `31874413569` before changing anything: `gh run view 31874413569
--log-failed | grep -E "Syntax error|Opening exp\+|expo run:android"`.

## Acceptance Criteria

- [ ] A decision is recorded (see below) — **commission** or **delete**. Do not leave a
      third state where the workflow exists and is red.
- [ ] If commissioning: the iOS job provisions Postgres against a version that actually
      exists on `macos-14` (install explicitly rather than assuming the image ships one;
      GitHub-hosted macOS runners have no Docker, so a service container is not available).
- [ ] If commissioning: the Android job's retry wrapper is rewritten as a **single line**, or
      moved out of the action's `script:` input into its own `run:` step — the action executes
      `script:` one line per shell, so re-quoting the existing block cannot work (see the
      corrected diagnosis above; the emulator is NOT the problem). The run then reaches and
      executes Maestro flows on both platforms.
- [ ] At least one **fully green** run exists, triggered via `workflow_dispatch`, before
      this todo is closed. A run that merely gets _further_ is not done — that is precisely
      how this reached 34 failures.
- [ ] The false comment at `.github/workflows/e2e-regression.yml:84-85` is corrected or
      removed.
- [ ] Failures reach a human. A scheduled job nobody watches is the root cause of the
      one-month gap, not a side note — the fix is not complete without it.

## Implementation Notes

- **Verify by dispatching, not by reading.** `workflow_dispatch` is already enabled. Iterate
  on a branch with manual runs; do not push a change and wait for the nightly.
- Expect **layers**. The iOS job has never executed anything past step one, so its native
  build, simulator boot, Metro startup, and the flows themselves are all completely
  unexercised. Budget for several iterations — that is what the original header predicted
  and what never got done.
- The `e2e/README.md` → CI section documents the flow inventory and coverage gaps; check it
  before assuming which flows are supposed to run.
- Related known-good context: `docs/solutions/code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md`
  is the same family of defect — a check that reports nothing useful while appearing to
  exist. Here it is worse than vacuous-green: it is vacuous-**red**, which actively trains
  people to ignore the Actions tab.

## Decision Required

A suite that has never passed and whose failures nobody reads has **negative** value: it
costs runner minutes, and it normalises a red workflow. Pick one, explicitly:

1. **Commission it.** Fix both jobs, prove one green dispatched run, and wire failure
   notification to somewhere a human actually looks.
2. **Delete it.** Remove the workflow and record in `e2e/README.md` that E2E is
   local/manual-only via Maestro MCP. Honest, and strictly better than a permanent red.

Option 1 is the better outcome if the Maestro flows are wanted; option 2 is better than the
status quo. The failure mode to avoid is doing neither.

## Scope Contract

- **Mechanisms to use:** the existing `.github/workflows/e2e-regression.yml`, its existing
  `workflow_dispatch` trigger, and the existing Maestro flows under `e2e/` — nothing new.
- **Files in scope:** `.github/workflows/e2e-regression.yml`, `e2e/README.md`, and the
  `e2e/` flows only if a flow itself proves broken once the jobs finally reach them.
- No changes to app code, `client/`, or `server/`. If a flow failure turns out to be a real
  product regression, that is a **separate** finding to surface, not to fix here.

## Dependencies

- None.

## Risks

- The iOS job is a black box past step one. Effort is genuinely unknown — it could be a
  one-line Postgres fix followed by a clean run, or several rounds of native-build and
  simulator-boot problems. Re-scope once the first green-ish run gets deeper.
- Do not let iteration churn land on `main` as a series of red nightlies. Iterate with
  `workflow_dispatch` on a branch.
- macOS runner minutes are free for this public repo (per the workflow header), so cost is
  not a constraint on iterating — but a 60-minute timeout per job means slow feedback.

## Updates

### 2026-08-15

- Filed after noticing the standing red while verifying the post-merge state of PR #812.
  Root causes for both jobs confirmed against run 31874413569, and the identical failure
  confirmed on the oldest retained run (2026-07-13), establishing it has never worked.
