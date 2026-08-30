---
title: "E2E Regression has never passed — 34/34 nightly runs failed, so the suite has produced zero signal since it landed"
status: blocked
priority: medium
created: 2026-08-15
updated: 2026-08-29
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

### 2026-08-29 — Two corrections to the 2026-08-16 diagnosis, two new root causes found and fixed, dispatch in flight

**Correction 1: the fixes described above were never left "unvalidated on a branch."** `32fa60b`
plus two further commits (`f8764715` docs, `3e28a835` code-review fixes) were squash-merged to
`main` via **PR #838** on 2026-08-16, closing the loop this entry's "Next session should"
note assumed was still open. Since then, **13 unattended nightly `schedule` runs** (2026-08-17
→ 2026-08-29) ran on `main` and failed identically every time — the notify-on-failure → Issue
#832 mechanism worked correctly throughout (16 comments by today), but nobody was watching it,
so this drifted for 12 more days exactly the way the original 34 failures did. The
`wip-e2e-regression-commission` branch itself no longer exists (renamed pre-merge, deleted
post-merge) — its dangling commit `32fa60b` is not on `main`, but its _content_ is (confirmed
by diffing `main`'s current workflow/flow files against it).

**Correction 2: both of last session's fixes ARE confirmed working.** The iOS diagnostic step
(gated on `steps.build-ios.outcome == 'failure'`, UDID-resolved `-destination`) fired on
run 33243164397 and — for the first time in this todo's history — surfaced a real `xcodebuild`
error instead of nothing. The Android dev-menu-overlay dismiss is confirmed present and running
(verified directly against a screenshot from that same run's retry attempt: the Sign In screen
renders cleanly, no overlay). Neither fix was wrong; each just uncovered the next layer.

**New root cause — iOS:** `error: compiling for iOS 15.1, but module 'CxxStdlib' has a minimum
deployment target of iOS 16.0`. Xcode 16.2 (already mandatory for RN 0.81) refuses to compile
because VisionCamera v5/NitroModules' Swift↔C++ interop pulls in `CxxStdlib`, which itself
requires ≥iOS 16.0 (see `docs/solutions/code-quality/vision-camera-ocr-plus-v5-cpp-interop-2026-06-02.md`
for the independent corroboration). **This is not a CI-only quirk** — `ios/Podfile` and
`ios/OCRecipes.xcodeproj/project.pbxproj` are the same committed native files used for local
dev and EAS builds, so any clean build with Xcode ≥16.1 (already required) would hit this.
**Fix (this session, user-approved deviation from the original Scope Contract, which named
only workflow/e2e files):** bumped `IPHONEOS_DEPLOYMENT_TARGET` 15.1→16.0 in
`ios/OCRecipes.xcodeproj/project.pbxproj` (4 occurrences — the value actually driving the
failing compile) and `ios/Podfile.properties.json`'s `ios.deploymentTarget` (was a stale
`"15.5"`, silently overriding the Podfile's own `'15.1'` fallback — that fallback was dead code
and was bumped too, defensively). Regenerated `ios/Podfile.lock` via `pod install`. **This
drops iOS 15.x support for the whole app**, recorded here explicitly as a product decision, not
silent scope creep.

**New root cause — Android:** downloaded the `logs-android` artifact already sitting on run
33243164397 (no new CI spend needed) and read the actual Maestro screenshots. The retry
attempt's login screen showed the username field containing the literal text **"undefined"**,
not `testuser` — `helpers/login.yaml`'s `${USERNAME}`/`${PASSWORD}` were never wired into
Maestro's own variable substitution. The GitHub Actions job-level `env:` block (`USERNAME:
testuser`) only populates the OS environment for the shell running `maestro test`; Maestro's
`${VAR}` flow-template substitution requires explicit `-e KEY=value` CLI flags (confirmed via
`maestro test --help`: `-e, --env=<String=String>`), which none of the `e2e:*` npm scripts ever
passed. Every flow's login therefore typed "undefined" as username, the server correctly
rejected it, and every downstream assertion (`visible`/`notVisible: "Sign In"`, depending on
which side of the login attempt a given flow checks) failed — explaining **both** of the
previously-reported failure directions as one bug, not two. Separately, even with correct
credentials, no CI step ever created the `testuser`/`testpass123` account in the job's fresh
Postgres instance. **Fix:** added `-e USERNAME=${USERNAME:-testuser} -e
PASSWORD=${PASSWORD:-testpass123}` to all three `e2e:*` scripts in `package.json`, and a "Seed
E2E test user" step (`curl -X POST /api/auth/register`, `|| true` for idempotency) to both jobs
right after the backend becomes healthy.

**Not a bug, confirmed via the same screenshot evidence:** the dev-menu-overlay dismiss fix
from last session is not blocking anything in the retry — it correctly no-ops (nothing to
dismiss) and the Sign In screen renders cleanly. The one cold-start case where the very first
flow of a job's first attempt is still connecting is exactly what the existing one-retry
mechanism is designed to absorb, and evidence shows it does.

**Status:** committed as `8ce512b4` on branch
`todo/P2-2026-08-15-e2e-regression-workflow-has-never-passed`, pushed, `workflow_dispatch`
triggered (run 33274867089) — outcome pending as of this entry. See the next entry (or this
one's edit, if landed before another session) for the result.

### 2026-08-29 (continued) — two more layers found via live dispatch, third cycle in flight

**Dispatch 1 (run 33274867089): caught and fixed before completion, no CI cost.** The seed-user
step's payload was missing a 4th required field — `registerSchema` (`server/routes/_schemas.ts`)
requires `ageConfirmed: z.literal(true)` (COPPA attestation) alongside username/password/email.
Without it the seed `curl` would 400, silently swallowed by its own `|| true`, leaving the
account never created. Found by reading the schema before waiting on CI, verified the corrected
payload against a running local dev server (`201`, real user+token), cancelled the run rather
than let it finish against the broken payload. Fixed in `2298729f`.

**Dispatch 2 (run 33274989658): both new hypotheses partially confirmed, two more real
findings.**

- **iOS still failed with the identical `compiling for iOS 15.1` error** despite the
  pbxproj/properties.json bump. Root cause: `react_native_post_install`'s own
  `ReactNativePodsUtils.updateOSDeploymentTarget` (in
  `node_modules/react-native/scripts/cocoapods/utils.rb`) floors **every individual pod
  target** at RN 0.81's hardcoded `min_ios_version_supported` (15.1) via
  `max(RN's constant, the pod's own existing setting)` — it reads neither this Podfile's
  `platform :ios` line nor the app target's own setting. Confirmed empirically: 308 of 354
  `IPHONEOS_DEPLOYMENT_TARGET` entries in the freshly-`pod install`ed `Pods.xcodeproj` were
  still `15.1`. Fixed with a second `post_install` sweep (same max-with-existing pattern,
  floored at 16.0 instead of RN's 15.1) — verified locally, all 354 now read `16.0`. Fixed in
  `aa748cca`.
- **Android: the credential/seed-user fix is confirmed working** — one flow
  (`Home - Navigate between tabs`) got past login for the first time in this todo's entire
  history, reaching a later `"Hello"` assertion. But most flows still failed on `"Sign In"`
  never becoming visible — worse than before on some flows. `metro.log` showed the first bundle
  took **50.5s**, already past the existing 45s wait, and every flow pays a full app relaunch +
  dev-client deep-link reconnect (not just bundling, which is cached/fast after flow 1), so
  under this run's CI resource contention the combined cost regularly exceeded 45s even for
  later flows. Also found, auditing every `"Sign In"` wait for the same gap:
  `auth/login.yaml` and `onboarding/complete-onboarding.yaml` never called
  `helpers/login.yaml` at all — they used a bare `assertVisible: "Sign In"` (Maestro's short
  stock default timeout, no tuned margin whatsoever). Bumped the helper's wait 45s→90s and gave
  both flows the same explicit `extendedWaitUntil`/90000 treatment (one of them twice, at its
  `clearState` register/login toggle). Fixed in `74feb546`.

**Dispatch 3 (run 33276571201): both hypotheses partially confirmed, two more findings.**

- **iOS: deployment target fully resolved** — the `CxxStdlib` error is completely gone,
  confirming the pod-wide sweep worked. A **new, unrelated** error took its place:
  `DateComponentsSerializer.swift:9:62: error: value of type 'DateComponents' has no member
'isRepeatedDay'`. The reference is gated `if #available(iOS 26.0, *)`, but `#available` only
  gates _runtime_ execution — Swift still resolves every identifier inside the block against
  the _compiling_ SDK, and Xcode 16.2 (pinned for RN 0.81) doesn't define this Foundation
  property yet. Speculative, forward-looking code in `expo-notifications` 55.0.14 for an OS
  version this toolchain doesn't know about — exactly the "next layer" this todo's own
  Implementation Notes predicted, unrelated to deployment target. Patched via `patch-package`
  (precedent: `patches/react-native-vision-camera+5.1.1.patch`), removing the 3 dead lines
  rather than pinning an older `expo-notifications` (which risks Expo-SDK-54
  autolinking/peer-dependency mismatches for a larger blast radius). Fixed in `5b26f696`.
- **Android: 90s margin didn't help** — most flows now hit the **full** 90s timeout (not a
  partial delay), while `Home - Navigate between tabs` succeeded fast (33-36s, past login, on
  its own separate `"Hello"` assertion) on both this run and the prior one. Ruled out
  bundling as the cause: `metro.log` showed the first bundle completing in 41.7s, and the
  specific flow examined ran minutes into the retry phase with Metro long since warm
  (~250ms cached). Pulled a screenshot at the exact timeout moment: it shows the Expo dev
  **MENU** (`"Connected to: http://localhost:8081"`, Reload/Go home, a Tools list) rendered as
  a bottom-sheet modal, with the Sign In screen's own blurred background photo visible behind
  it — the real screen is loaded underneath, not still loading. **A second, different overlay**
  from the "developer menu... Continue" welcome banner already fixed and confirmed working —
  same category, different trigger, never caught before because earlier screenshots only ever
  captured the welcome-banner case. No stable text/id identifies a dismiss button for this one;
  used Android's own back gesture, gated behind detecting `"Go home"` so it can't fire (or
  navigate the app backward) when the menu isn't showing. Verified the
  `runFlow: {when, commands}` conditional syntax locally against the installed Maestro CLI
  before spending CI on it. Fixed in `e1fb20ce`, **NOT YET VERIFIED on live CI**.

**Dispatch 4 (run 33278558247): iOS one more layer (patched); Android back-dismiss didn't fire,
but the real bug was found underneath it.**

- **iOS**: `expo-notifications` fix worked cleanly — immediately hit the identical _category_ of
  bug in a different vendored package: `react-native-vision-camera`'s
  `CMFormatDescription.MediaSubType+hidden.swift` references
  `kCVPixelFormatType_96VersatileBayerPacked12`, a CoreVideo constant Xcode 16.2's SDK doesn't
  define (unconditional this time, not gated by `#available`). Removing it broke a second file
  (`AV+PixelFormat.swift`'s `case .rawBayerPacked9612Bit:` switch arm) that referenced it —
  removed both; the switch's existing `default:` branch already logs-and-falls-back to
  `.unknown`, a safe degradation since RAW Bayer 12-bit capture isn't part of this app's
  barcode/OCR use case. Extended the project's existing load-bearing
  `patches/react-native-vision-camera+5.1.1.patch` rather than adding a second patch for the
  same package. **Caught a real mistake while generating it**: the first `patch-package` run
  picked up an unrelated 785MB local Android CMake build-cache directory
  (`node_modules/.../android/.cxx/`, pre-existing on this machine, gitignored, differed from a
  fresh install) into an 80,000-line polluted patch — `rm -rf` on it was correctly blocked by
  this session's safety guard; re-ran with `--exclude` instead for a clean 26-line diff, checked
  against `git diff` before committing. Fixed in `47f817fe`.
- **Android: the back-dismiss fix from dispatch 3 never fired** — its own `runFlow: {when:
visible: "Go home"}` logged `SKIPPED` (confirmed via `maestro.log`, not assumed), meaning
  that specific overlay wasn't the blocker for the flow examined. Pulled its screenshot anyway
  at the exact "Sign In" timeout: it showed a **third, different** dev-client screen — the
  _original_ "This is the developer menu... Continue" welcome overlay from the very first
  (2026-08-16) diagnosis. **The real bug**: that overlay's own dismiss step still had its
  _original_ 5000ms wait, checked immediately after `openLink` — seconds into a still-loading
  app — so it always found nothing and gave up, then the overlay appeared for real once the
  bundle actually finished (~40-50s) with nothing left to dismiss it. This is why bumping the
  _Sign-In_ wait to 90s in dispatch 2 never helped: the overlay sat there obscuring it for the
  entire 90s regardless of how long that wait was — the wrong step had the margin. An earlier
  entry in `e2e/helpers/launch-app.yaml` claiming this was "CONFIRMED FIXED" was wrong — it was
  based on a screenshot that only ever showed the no-op case, not this one. Bumped the
  Continue-wait itself to the same 90s margin (where the cold-start delay actually needs
  absorbing); left the "Go home" wait short since it's still unconfirmed as a real recurring
  blocker (evidence: it was skipped, not proven unnecessary — worth revisiting only if a future
  screenshot shows that screen surviving this fix). Fixed in (pending commit).

**Dispatch 5 (run 33280577594): iOS hit a fourth, different-shaped failure that reframed the
whole iOS track; Android's real result is unknown — it hit the job timeout, not a verdict.**

- **iOS**: NOT another missing symbol this time — a **swift-frontend internal compiler crash
  (ICE)** during IR generation, inside the `NitroImage` pod's "Copy generated compatibility
  header" script phase (`swift::performIRGeneration` in the crash backtrace). Before writing a
  fourth patch, stepped back (advisor review) and named the pattern across all four iOS
  failures: `expo-notifications` gates `isRepeatedDay` behind `#available(iOS 26.0, *)`;
  `vision-camera` references a CoreVideo constant that doesn't exist yet; and **this repo's own
  Podfile already documents the real baseline** — the fmt/consteval patch exists because fmt
  "does not compile under Xcode 26 / Apple clang 21", and the existing VisionCamera
  `SWIFT_COMPILATION_MODE = singlefile` workaround cites "Swift 6.2 (Xcode 26) ICE with
  nitrogen-generated C++/Swift interop (swiftlang/swift#76143)" — the _exact_ crash class hit
  here, just in a target (`NitroImage`) the existing fix's `start_with?('VisionCamera')` filter
  doesn't cover. **This repo's native config is written for and already assumes Xcode 26** — CI
  was pinned to 16.2 only because RN 0.81 needs ≥16.1 and that's what the `macos-14` image
  offered, a floor misread as a target. Verified via GitHub's own runner-images docs (zero CI
  spend): `macos-14` tops out at Xcode 16.2 (no newer option existed there at all); `macos-15`
  ships **Xcode 26.3** (build 17C529) alongside 16.x — an exact match, without jumping to
  `macos-26`'s bleeding-edge Xcode 27. Switched `runs-on: macos-14` → `macos-15` and the
  Xcode-select step to 26.3. **Reverted both vendor-code deletions** from dispatches 3-4
  (`expo-notifications`' `isRepeatedDay` removal, `vision-camera`'s `rawBayerPacked9612Bit`
  removal) — they were workarounds for 16.2's SDK ceiling, not real bugs, and 26.3's SDK should
  define both symbols natively; restored `patches/react-native-vision-camera+5.1.1.patch` to
  its pre-session content (diffed against `main`, byte-identical except the reverted hunks) and
  deleted `patches/expo-notifications+55.0.14.patch` entirely. Net scope versus this session's
  iOS changes so far: **less** permanent repo modification, not more. Kept the deployment-target
  bump (still a real, independent fix regardless of Xcode version). Fixed in `36a40055`,
  **NOT YET VERIFIED**.
- **Android: inconclusive, not failed.** The job was killed by its own `timeout-minutes: 60` at
  exactly 60m03s, mid-retry — a timeout, not a verdict on the Continue-overlay fix. What did run
  before the cut: every flow now consistently takes **either** ~46s-1m22s (`Plan - Meal plan
home and pantry`, both attempts — past login fast, but failing on a _different_, unexplored
  `"Plan"` element-not-found) **or** the full 3m5s / 185s (every other flow, both attempts —
  matching Continue-wait-90s + Sign-In-wait-90s + overhead maxing out _both_ waits, still ending
  on the same `"Sign In" is visible` failure). The fix's own timing structure is confirmed
  taking effect (flows that used to fail at ~100s now consistently take ~185s), but whether it
  actually _resolves_ anything for most flows is still unknown — the job never got far enough to
  print a real Flows-Passed/Failed summary for the retry. Bumped `timeout-minutes: 60 → 90` on
  the Android job so the _next_ dispatch can reach an actual verdict instead of another
  ambiguous timeout, rather than guessing at a fifth Android theory on top of an already-unclear
  result.

**Dispatch 6 (run 33283020295): the runner-image pivot worked — iOS is down to a trivial,
well-understood last blocker; Android still in flight as of this entry.**

- **iOS: every compile/toolchain layer from dispatches 2-5 is gone.** `xcode-select -s
/Applications/Xcode_26.3.app` succeeded (confirming that path is real on `macos-15`), and the
  job got past the point where all four previous failures (CxxStdlib, `isRepeatedDay`,
  `kCVPixelFormatType_96VersatileBayerPacked12`, the NitroImage swift-frontend ICE) would have
  fired — none of them did. It failed at the **"Boot iOS simulator" step**, before the app build
  even starts: `Invalid device or device pair: iPhone 15`. Confirmed via GitHub's runner-images
  docs (zero CI spend): Xcode 26.x's default simulator lineup starts at **"iPhone 16"** —
  `"iPhone 15"` (carried over unchanged from the `macos-14`/Xcode 16.2 pin) simply isn't in it.
  Swapped all 3 occurrences (`simctl boot`, `simctl bootstatus`, the UDID-resolution match) to
  `"iPhone 16"`. Fixed in (pending commit) — high confidence this is the last iOS blocker, since
  everything downstream of simulator boot (backend, Metro, the actual build, Maestro) was never
  reached yet to say otherwise.
- **Android: still running as of this entry**, now with real room (90 min) to reach an actual
  verdict on the Continue-overlay-wait fix instead of another timeout.

**Dispatch 6, Android result (same run, 33283020295): the Continue-overlay fix and the
Go-home back-dismiss were BOTH exonerated — and both reverted — because the real bug is one
level further up the stack than either theory.** With the 90-minute job timeout finally giving
the retry room to finish, 7 of 8 flows failed identically on `"Sign In" is visible`, same as
every prior dispatch — but this time `maestro.log` timing on `Auth - Login flow-2` showed
**neither overlay wait ever found anything**: the Continue-wait logged `WARNED` only after
burning the full ~90.6s with nothing to dismiss (not the "found it late" pattern that indicated
a real overlay in dispatch 4), and the Go-home wait logged `WARNED` in 0.67s flat. Pulling the
actual screenshot at the exact `"Sign In"` failure moment (`step-010-assertCondition-Sign_In.png`)
settled it: the app was showing neither Sign In nor either overlay — it was on the **onboarding
wizard's first screen** ("Let's Personalize Your Experience… 6 quick steps… Get Started").

**Working hypothesis, STRONGLY INDICATED but NOT YET CONFIRMED: cross-flow session bleed, not
a rendering/timing bug.** Every flow in a job reconnects via `helpers/launch-app.yaml`'s plain
`openLink` (no `clearState`) except the two flows that explicitly clear state for their own
register/login toggle — the working theory is that once _any_ flow in the job successfully
authenticates as the seeded `testuser`, the JWT persists in the app's storage across every
later flow's relaunch. `testuser` is a freshly seeded account whose registration response, in
this session's own local `curl` test earlier, showed `onboardingCompleted: false` — but that
was a local test, not a check against the actual CI-seeded account at the actual moment these
flows ran. So the theory is: the first flow to actually log in successfully routes correctly
past Sign In, and every flow after it, on relaunch, finds an already-authenticated session and
gets routed straight to onboarding instead of Sign In. This is a single, structural explanation
that would fit every piece of evidence collected across dispatches 3-6, not another instance of
the same overlay bug — but two links in the chain are inferred, not observed: whether the JWT
actually survives an `openLink` reconnect on the Android dev client (vs. some other path landing
on onboarding), and whether an _earlier_ flow in the job actually authenticated successfully at
all. **Two unverified claims below are marked as such; treat the whole hypothesis as unconfirmed
until they're checked.**

If this hypothesis holds, the evidence would explain:

- Why _every_ flow but one fails the same `"Sign In"` assertion, regardless of wait length —
  waiting longer never helps a screen that was never going to appear.
- Why `Plan - Meal plan home and pantry` is the one consistent outlier, getting past login
  fast every run — it isn't beating an overlay, it's just not blocked by one; it fails later on
  its own unrelated `Element not found: Text matching regex: Plan` (not yet investigated).
- Why both overlay fixes stopped finding anything to dismiss once the credential/seed-user bug
  (dispatch 2) was fixed and a real account started actually authenticating — the overlays were
  never the steady-state blocker; they were transient artifacts of earlier, different bugs
  (theory 3 in dispatch 3, and the true dispatch-4 cold-start race) that happened to coincide
  with screenshots taken while those other bugs were still active.

**Confirming check, zero CI cost — DONE, and it revises the mechanism.** Pulled the
already-downloaded run-33283020295 Android artifact and checked `Auth - Login flow` (attempt 1,
no `-2` suffix) — the very first flow of the entire job, so nothing could have run before it.
**It shows the identical onboarding screen at the identical step.** This _disconfirms_ the
original framing (bleed from some unrelated earlier flow) but _confirms_ a more precise
mechanism, visible directly in the flow file (`e2e/flows/auth/login.yaml`): this single flow
logs in as `testuser` successfully partway through (landing on onboarding is correct app
behavior for a fresh `onboardingCompleted: false` account — not a failure, the flow's own check
here is only `notVisible: "Sign In"`, which onboarding satisfies), then explicitly calls
`launchApp: { clearState: true }` specifically to force a clean Sign-In screen back, so it can
test the sign-up toggle. **Step 10 — the one that fails, in both attempt 1 and the `-2`
retry — is the `extendedWaitUntil: visible: "Sign In"` right after that `clearState`.** The
client stores its JWT in plain `AsyncStorage` (`client/lib/token-storage.ts`, key
`@ocrecipes_token`), not Keystore/SecureStore-backed, so there's no obvious reason `clearState`
should fail to wipe it — but empirically, whatever survives (or races) `clearState` here is
enough to auto-re-authenticate the app on relaunch and route it straight back to onboarding.
**Not yet confirmed:** whether Maestro's Android `clearState` itself is unreliable (a race
between the OS-level data wipe and the relaunch's read, or a known tool limitation), versus some
other client-side persistence this session hasn't found. That would need one more artifact check
(a hierarchy/logcat dump from the same step, if the workflow ever captures one) or a targeted
local repro — not attempted here, out of session scope.

This also reframes why 6 of the other 7 flows fail identically: none of them call `clearState`
at all (a plain `openLink` reconnect, same as this flow's _first_ connection) — so if this
flow's login (or any flow's) leaves a working token in the same still-installed app on the same
emulator for the rest of the job, every later flow's ordinary reconnect inherits it the same
way. The original cross-flow-bleed framing was directionally right about the _symptom_
(persisted auth) but wrong about the _source_ (not "nobody happens to clear state", but "the one
step that explicitly tries to clear state doesn't reliably do so").

**Reverted, not carried forward:** the Continue-wait's 5000ms→90000ms bump (`26689be0`) and the
Go-home back-dismiss (`e1fb20ce`) — both built on a diagnosis this screenshot overturns. Left in
place they'd cost every stuck flow ~185s of dead waiting for overlays that are never there, and
would mislead the next reader into re-investigating an already-closed line. `e2e/helpers/launch-app.yaml`
is back to its pre-session baseline (5000ms Continue-wait, no dev-menu handling), with a header
comment recording why and pointing here. The Sign-In-wait bump itself (45s→90s, `74feb546`) is
**kept** — it has independent justification (measured bundle-load timing) and is harmless
regardless of the session-bleed bug.

**Not attempted this session — a genuine flow-semantics decision, not a quick fix:** three
candidate fixes exist and none has been evaluated against CI yet. **Candidate 1's priority
drops** given the confirming check above — `auth/login.yaml` already calls `clearState: true`
before the exact step that fails, so "add clearState everywhere" may not fix anything if
Maestro's Android `clearState` is the unreliable part, rather than merely being absent.

1. ~~Add `clearState: true` to every flow's initial launch~~ — **weakened by the confirming
   check**: the one flow that already does this still fails at the identical step, right after
   its own `clearState`. Worth retrying only alongside a fix for _why_ `clearState` doesn't
   clear the token here (see "Not yet confirmed" above) — adding it blind is unlikely to help
   and still risks resurrecting the 2026-08-16 welcome-banner overlay on every flow.
2. Seed `testuser` with `onboardingCompleted: true` (or seed a distinct pre-onboarded account
   for flows that assume a logged-in, fully-onboarded state) — narrower blast radius, doesn't
   depend on `clearState` working at all, but doesn't fix flows (like this one) that
   specifically need a _fresh, logged-out_ Sign-In screen mid-flow.
3. Explicit logout at the start (or end) of each flow that expects a logged-out `"Sign In"`
   screen, tapping a real in-app logout control so it goes through the app's own
   `tokenStorage.clear()` (`client/lib/token-storage.ts`) rather than depending on Maestro's
   Android `clearState` — **strengthened by the confirming check**: if `clearState` really is
   the unreliable link, going through the app's own code path sidesteps that dependency
   entirely rather than fixing or working around it. Most surgical of the three, but needs
   locating (or adding, if it doesn't exist as an accessible element) a stable logout control
   in the Profile screen.
   Each has a real tradeoff and needs its own CI validation; none is a two-line fix, so none was
   guessed at blind this session.

**iOS status, precise claim:** the `iPhone 15`→`iPhone 16` device-name fix (committed
`e2f5da26`) is pushed, and a dispatch to validate it (run 33285727372) is in flight as of this
entry — see the next entry for its outcome. Getting past "Boot iOS simulator" would confirm the
device name is valid — it would **not** by itself confirm the app actually compiles under
Xcode 26.3, since no dispatch has reached the build step yet (dispatch
6 failed at simulator boot, before `xcodebuild` ran). The four previously-fixed compile-time
errors are inferred gone because the runner image changed under them, not because a build has
succeeded. Say so plainly rather than treating "cleared simulator boot" as "iOS is green."

**Session status:** stopping here rather than dispatching further blind. This session ran 6 real
CI dispatches (well past the original 4-5 budget) and converged on a precise, evidence-backed
root cause for Android that changes the fix from "overlay dismiss" to "session isolation" — a
real, structural finding, not a dead end, but one that needs a deliberate choice among the three
candidates above before the next dispatch, not another guess. iOS has one small, well-isolated,
unvalidated fix ready to go. Both are pushed to
`todo/P2-2026-08-15-e2e-regression-workflow-has-never-passed` as of this entry. Still `blocked`,
not `done` — no dispatch this session reached a green run on either job.
