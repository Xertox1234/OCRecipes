# E2E Tests (Maestro)

## Prerequisites

- [Maestro CLI](https://maestro.mobile.dev/) installed: `brew install maestro`
- Backend running: `npm run server:dev`
- App built and running in iOS Simulator: `npx expo run:ios`

## Environment Variables

All flows that require authentication use these env vars:

| Variable   | Description           | Default       |
| ---------- | --------------------- | ------------- |
| `USERNAME` | Test account username | `testuser`    |
| `PASSWORD` | Test account password | `testpass123` |

Set them before running:

```bash
export USERNAME=testuser
export PASSWORD=testpass123
```

## Running Tests

```bash
npm run e2e             # Run all E2E flows
npm run e2e:smoke       # Run smoke-tagged flows only (auth + navigation + onboarding)
npm run e2e:regression  # Run regression-tagged flows (the critical-flow set CI runs nightly)
```

## CI

The `E2E Regression` workflow (`.github/workflows/e2e-regression.yml`) runs
`npm run e2e:regression` **nightly (scheduled)** and on manual
`workflow_dispatch`, on both an iOS simulator (macOS runner) and an Android
emulator (Linux runner + KVM).

**Trigger decision — scheduled, not PR-gated (2026-07).** PR-gating would catch
regressions before merge, but adds ~30-45 min of native-build latency to every
PR and puts an inherently flaky suite on the required-check path, eroding trust
in required checks. The scheduled run catches regressions within a day of merge
without blocking anyone. PR-gating is a deliberate later step, to be revisited
once the nightly flake rate is proven low — and if adopted it must stay a
separate check, never folded into the fast lint/type/test preflight path. This
workflow is intentionally **not** in the branch-protection required-check list;
a red run never blocks a merge. Flake tolerance: the Maestro step retries once
before failing the job.

**Failure notification (2026-08).** The workflow does not rely on the Actions
tab or GitHub's scheduled-workflow email — a failed run files or updates a
single GitHub Issue labelled `e2e-regression-failure` (see the `notify-on-failure`
job) so a red night is visible without anyone watching the tab.

### Critical-flow coverage (`regression` tag)

| Target critical flow | Flow file                                            | Coverage notes                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                | `auth/login.yaml`                                    | Full: credentials → authenticated session, plus register-mode toggle                                                                                                                        |
| Onboarding           | `onboarding/complete-onboarding.yaml`                | Full: register → all 6 onboarding screens → home                                                                                                                                            |
| Tab navigation       | `home/navigate-tabs.yaml`                            | Full: Home / Plan / Coach / Profile round-trip; Scan FAB asserted present (Scan is a FAB, not a tab)                                                                                        |
| Scan                 | `scan/scan-barcode.yaml`, `scan/photo-analysis.yaml` | **Partial (gap)**: simulators/emulators have no camera, so flows assert the scan screen loads and intent UI renders; the capture step itself is untestable in CI                            |
| Log                  | `home/view-item-detail.yaml`                         | **Partial (gap)**: verifies the history surface (Profile → Scan History) where logged items appear; there is no camera-free "log a food item" flow (the primary log path goes through scan) |
| Coach chat           | `home/chat.yaml`                                     | **Partial**: entry point + suggested prompts; AI responses are not asserted (CI stubs the OpenAI key)                                                                                       |
| Meal plan            | `plan/meal-plan-home.yaml`                           | Full: Plan tab → recipes/pantry/grocery sections + meal slots                                                                                                                               |

Known gaps, in priority order: (1) a camera-free food-log flow (e.g. manual
entry) so "log" has direct coverage; (2) an asserted coach-chat response once a
deterministic AI stub exists; (3) the camera capture path, which requires a
physical device and stays out of CI scope.

## Flow Structure

```
e2e/
  config.yaml            # Workspace config — Maestro only discovers Flows at
                          # the top level of a directory by default; this
                          # opts into recursive discovery under flows/ and
                          # deliberately excludes helpers/ (runFlow deps, not
                          # standalone Flows)
  helpers/
    launch-app.yaml     # Connect to the dev client, then clear whatever is in
                        # the way: a lingering iOS "Save Password?" dialog, the
                        # dev-client welcome banner, and the dev menu sheet the
                        # banner sits on top of. Every flow's first step is
                        # `runFlow` into this, never a bare `launchApp`
    ensure-logged-out.yaml  # Force a logged-out Sign In screen via the app's
                        # real Sign Out control (Profile → Settings), with a
                        # wizard-escape for a stranded onboarding state.
                        # `launchApp: { clearState: true }` is BANNED in this
                        # suite: Android's pm clear wipes the dev client's own
                        # storage (stranding the relaunch on its launcher), and
                        # the split per-platform app ids (iOS
                        # com.williamtower.ocrecipes vs Android
                        # com.ocrecipes.app) make appId-based commands a trap
    login.yaml          # State-aware login helper — logs in only when the
                        # Sign In screen is actually showing (an inherited
                        # session short-circuits), dismisses the iOS
                        # Save-Password dialog, and exits on the Home screen.
                        # Self-heals a wizard-stranded app (a prior flow died
                        # mid-registration) by front-running ensure-logged-out
                        # when a wizard marker is visible — so must stay the
                        # FIRST step after launch-app.yaml.
                        # Call with `runFlow` + env USERNAME/PASSWORD (see
                        # e2e-regression.yml's "Seed E2E test user" step for
                        # what account exists in CI)
  flows/
    auth/               # Authentication flows
    onboarding/         # Registration + onboarding
    home/               # Home tab, history, chat, exercise
    scan/               # Camera, barcode, photo analysis
    plan/               # Recipes, grocery lists, meal planning
    profile/            # Profile settings, goals, weight
```
