---
title: "E2E Regression has never passed — 34/34 nightly runs failed, so the suite has produced zero signal since it landed"
status: blocked
priority: medium
created: 2026-08-15
updated: 2026-08-16
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

- [x] A decision is recorded (see below) — **commission** or **delete**. Do not leave a
      third state where the workflow exists and is red. — **Commission** (2026-08-16).
- [x] If commissioning: the iOS job provisions Postgres against a version that actually
      exists on `macos-14` (install explicitly rather than assuming the image ships one;
      GitHub-hosted macOS runners have no Docker, so a service container is not available).
- [x] If commissioning: the Android job's retry wrapper is rewritten as a **single line**, or
      moved out of the action's `script:` input into its own `run:` step — the action executes
      `script:` one line per shell, so re-quoting the existing block cannot work (see the
      corrected diagnosis above; the emulator is NOT the problem). The run then reaches and
      executes Maestro flows on both platforms.
- [ ] **At least one fully green run exists, triggered via `workflow_dispatch`, before
      this todo is closed. NOT MET — still open, see 2026-08-16 Update.** A run that merely
      gets _further_ is not done — that is precisely how this reached 34 failures.
- [x] The false comment at `.github/workflows/e2e-regression.yml:84-85` is corrected or
      removed.
- [x] Failures reach a human. A scheduled job nobody watches is the root cause of the
      one-month gap, not a side note — the fix is not complete without it. GitHub Issue #832.

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

### 2026-08-16 — Decision: COMMISSION. Both original bugs fixed and verified; new layers found underneath; reporting BLOCKED, not done

**Decision recorded:** commission, not delete. Both jobs now genuinely build the app, boot a
simulator/emulator, and execute real Maestro flows with real assertions — this was not true
before this session (see "Two originally-diagnosed bugs" below). The remaining blockers are
narrower and better-understood than "zero signal ever produced."

**Acceptance criteria status:**

- [x] Decision recorded (commission).
- [x] iOS Postgres provisions a version that exists on `macos-14` (`postgresql@16`, explicit
      install + PATH export — the pinned `postgresql@14`/bare-fallback bug is fixed and
      confirmed not to recur across 3 live runs).
- [x] Android retry collapsed to a single line — confirmed fixed across all 3 live runs
      (the `sh: Syntax error` never recurred; the retry genuinely re-invokes).
- [x] False Postgres-availability comment corrected.
- [x] Failures reach a human — `notify-on-failure` job files/updates GitHub Issue #832,
      verified working on every one of the 3 live failing runs (issue body on first failure,
      one comment per failure after).
- [ ] **At least one fully green `workflow_dispatch` run — NOT MET.** This is why the todo is
      `blocked`, not `done`, despite the above. Three live `workflow_dispatch` runs on
      `wip-e2e-regression-commission` (31935149988, 31937173879, 31938889879) all ended
      `failure` on both jobs. The session's CI-attempt budget is exhausted for now.

**Two originally-diagnosed bugs — CONFIRMED FIXED across all 3 live runs:**

1. iOS Postgres: `brew install postgresql@16` + PATH export + `brew services start`, matching
   the version ci.yml and the Android job's service container already use.
2. Android retry: collapsed the `||  { ...; }` block in
   `reactivecircus/android-emulator-runner`'s `script:` to one line (the action runs
   `script:` one shell per line, so a multi-line brace group can never survive it).

**Previously-undiscovered layer, found and fixed once the above stopped blocking either job
from ever reaching Maestro at all:** the Maestro CLI's real surface didn't match what the
pre-existing flow files assumed — `--tags` doesn't exist (`--include-tags` does); flow
discovery isn't recursive by default (added `e2e/config.yaml` with `flows: ["flows/**"]`);
`assertVisible`/`tapOn` + a sibling `timeout:` is invalid schema (converted to
`extendedWaitUntil`); a sibling-level `optional: true` is invalid (must nest inside the
command's own map). All 15 flow files + the shared login helper were fixed and independently
re-verified by `code-reviewer`. Once fixed, both jobs began genuinely building, installing,
and running all 8 regression-tagged flows — this is the biggest structural change from this
session: **the suite executes for the first time in its history.**

**Android — root cause chased through 3 competing theories; only the 3rd was checked against
a screenshot, and it's the one that held up.** All 8 flows failed identically for all 3 runs
on `Assertion is false: "Sign In" is visible`, which looks like one bug but is two:

1. _Cold-Metro-bundle theory_ (session's first guess): extended the login wait 20s→90s.
   Falsified — flows still failed after exhausting the full 90s, even though metro.log showed
   the bundle completing in ~54-58s, well inside the window.
2. _Bare-`launchApp`-never-reaches-Metro theory_ (session's second guess, informed by
   `code-reviewer`'s skepticism of theory 1): replaced every flow's bare `launchApp` with
   `openLink` to the dev-client deep link (`exp+ocrecipes://expo-development-client/?url=
http://localhost:8081`), reusing the Android job's existing `adb reverse tcp:8081 tcp:8081`
   tunnel. Also falsified on the very next live run — byte-identical 8/8 failure, same
   assertion, same timings.
3. _Confirmed, via Maestro's own screenshot artifact_ (the debug-output config from theory 2's
   run had silently written nothing — `testOutputDir` is not a real `e2e/config.yaml` key for
   Maestro 2.6.0; fixed by moving to the `--debug-output`/`--flatten-debug-output` CLI flags on
   the `e2e:*` npm scripts, which is when screenshots finally appeared): **there are two
   different failure modes, not one.**
   - The _first_ flow to run in a session can still be mid-bundle — its screenshot shows
     `Bundling 96.0%…` at the moment the assertion times out. Genuinely a cold-start race,
     just one closer to the timeout than the 90s test suggested (bumped the wait 30s→45s).
   - _Every subsequent flow_ shows the actual Sign In screen correctly rendered underneath —
     dimmed by the Expo dev-client's own "developer menu" welcome overlay (`This is the
developer menu… Continue`) popping up on top of it. Neither theory 1 nor 2 could have
     found this; both were timing/connectivity theories about a screen that, it turns out, was
     rendering fine.
   - Fix (commit `32fa60b`, **NOT YET VALIDATED ON CI** — this session's attempt budget was
     spent confirming theories 1 and 2 before this one was found): dismiss the overlay
     (`optional` `tapOn: "Continue"`) right after connecting, in `e2e/helpers/launch-app.yaml`
     and the two flows that reconnect manually after `clearState`.
   - Lesson for next time, worth codifying: a screenshot beats two rounds of timing theories.
     The debug-output misconfiguration (a wrong config.yaml key, silently producing zero
     files) cost a full CI round-trip that would have shown this immediately.

**iOS — still a black box, one layer deeper than the original diagnosis, with no fix landed.**

1. Fixed and confirmed not to recur: `macos-14` defaults to Xcode 15.4; React Native 0.81
   needs ≥16.1. Added `sudo xcode-select -s /Applications/Xcode_16.2.app` before the Postgres
   step.
2. Current blocker: `xcodebuild` reports `0 error(s), and 6 warning(s)` and then exits 65
   (`CommandError: Failed to build iOS project`). Confirmed the vision-camera patch
   (`patches/react-native-vision-camera+5.1.1.patch`) and the fmt/clang Podfile `post_install`
   patch both apply correctly in CI (`patch-package` reports success; `[fmt] patched base.h`
   appears in the log) — neither of the two repo-specific "known load-bearing" risks is the
   cause. Grepped two full job logs for `error:`/`fatal error:`/`BUILD FAILED` — zero matches
   in either. `expo run:ios`'s own wrapper appears to genuinely not have the real error to
   show (its failure message says as much: "try building the app with Xcode directly").
   Added a failure-only diagnostic step that re-invokes `xcodebuild` directly (bypassing
   expo's formatter) — its first version used a name-based `-destination` that doesn't
   resolve on this runner image and never reached the real error either (fixed in commit
   `32fa60b` to resolve and reuse the exact booted simulator UDID, the same way `expo run:ios`
   itself does). **This diagnostic step is unvalidated — no live run has exercised the fixed
   version yet.**

**Why this is `blocked`, not `done`:** the dispatching session's explicit binding constraint
was that a genuinely green `workflow_dispatch` run is required before closing this todo — "a
run that merely gets further is not done." Two more root causes were found and fixed this
session (Android's dev-menu overlay; iOS's UDID-based diagnostic step), but neither has been
validated by a live run — the session's bounded CI-attempt budget (3 attempts, per explicit
orchestrator instruction) was exhausted reaching this diagnosis. Landing an unvalidated fix
and calling it done would repeat exactly the failure mode this todo exists to fix.

**Next session should:** dispatch `workflow_dispatch` on the current branch tip. If Android
goes green, that confirms the dev-menu-dismiss fix and the todo can likely close on that side.
If iOS still fails, the new diagnostic step should — for the first time — show the actual
`xcodebuild` error; read it and fix accordingly. Budget at least 2-3 more iterations; do not
assume the first re-run is green.

**Code-review finding worth flagging explicitly (not fixed, by design):** fixing the
`optional: true` sibling-nesting bug (see "previously-undiscovered layer" above) converts ~59
previously-broken-but-accidentally-_mandatory_ assertions into genuinely skippable ones — and
in several flows, the assertions covering the flow's own stated subject matter are now
entirely optional (e.g. `home/chat.yaml`: past login, every NutriCoach-specific step —
opening a new chat, seeing suggested prompts, tapping one, waiting for a response — is
`optional: true`, so a flow named "NutriCoach chat interaction" can complete having asserted
nothing chat-related; similar shape in `plan/browse-recipes.yaml`, `plan/grocery-list.yaml`,
`plan/meal-plan-home.yaml`, `profile/goal-setup.yaml`). This is a correct, necessary
consequence of fixing a real schema bug — the steps were clearly _authored_ to be optional,
just malformed in a way Maestro silently ignored — not something to revert. Flagging it here
because it's the same _class_ of defect ("looks like it verifies something, actually doesn't")
that this whole todo exists to eliminate, just one level down from workflow-granularity to
flow-granularity. Follow-up (not done this session, out of the immediate CI-attempt budget):
audit each touched flow for at least one assertion that mandatorily pins its stated purpose.
