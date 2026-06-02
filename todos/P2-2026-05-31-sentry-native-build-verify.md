---
title: "Verify Sentry Expo plugin native build after PR #288 merge"
status: backlog
priority: medium
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, observability, deferred]
github_issue:
---

# Sentry native build verification

## Summary

PR #288 added `@sentry/react-native/expo` to `app.json` plugins, but native build verification could not be done in an executor worktree. The Sentry Expo plugin writes iOS/Android native init files during `expo prebuild` — this needs a manual verification pass before the observability stack is fully wired end-to-end.

## Background

PR #288 explicitly deferred this: _"Native iOS/Android build verification cannot be done in the executor worktree — run npx expo prebuild (no --clean) on the main checkout after merge."_

The JS-level wiring (`initReporter()`, `reportError()`, `logger.*`) works without a native build. The Sentry plugin's native changes (automatic crash reporting, native stack frames in Sentry events) only activate after a prebuild + rebuild. Until then, Sentry captures JS errors but misses native crashes and has no source maps.

## Acceptance Criteria

- [ ] `npx expo prebuild` (without `--clean`) runs without error on main after PR #288 merge.
- [ ] `ios/` and `android/` contain the Sentry native init hooks (`SentrySDK.start` in `AppDelegate`, Sentry Gradle plugin in `android/`).
- [ ] `npx expo run:ios` builds and launches in the iOS Simulator without errors.
- [x] `EXPO_PUBLIC_SENTRY_DSN` is documented (in `docs/DEV_SETUP.md` "Mobile Client" — no `.env.example` exists in this repo; DEV_SETUP.md is the tracked env-var source) so it's not forgotten at first deployment.
- [ ] The `--clean` flag is NOT used (it destroys Podfile customizations in the gitignored `ios/` directory — see memory `feedback_no_expo_prebuild_clean`).

## Implementation Notes

- Run from the main checkout: `npx expo prebuild` (no flags beyond `--platform ios` if iOS-only for now).
- If the prebuild modifies `ios/Podfile` or `android/build.gradle` in a way that conflicts with existing customizations (MLKit fat-binary patch, strip-push-entitlement plugin), investigate before committing.
- The `EXPO_PUBLIC_SENTRY_DSN` env var is currently unused (no DSN configured). No traffic is sent until it's set. Add it to `.env.example` as a documented-but-empty entry.
- Reference: `docs/DEV_SETUP.md` for iOS Simulator setup.

## Dependencies

- PR #288 merged ✓
- Must be done on the main checkout (not a worktree) — `ios/` and `android/` are gitignored.

## Risks

- `expo prebuild` may conflict with the MLKit fat-binary Podfile hook added for iOS 26 simulator support (see memory `project_ios26_simulator_fix`). Inspect diffs carefully.

## Updates

### 2026-05-31

- Created from PR #288 review deferred warning. Executor worktrees can't run prebuild.

### 2026-05-31 (prebuild verified on main checkout — AC partially met)

Ran `npx expo prebuild --platform ios --no-install` on the main checkout during a `/todo` follow-up:

- ✅ `prebuild` exits 0 (`✔ Finished prebuild`), no errors.
- ✅ **MLKit Podfile customization preserved** — `ios/Podfile` is byte-identical to the pre-prebuild backup (125 lines); the iOS-26 `patch-mlkit-simulator.py` `post_install` hook survives. This was the main risk (memory `project_ios26_simulator_fix`).
- ✅ `package.json` unchanged (`✔ Updated package.json | no changes`).
- ⚠️ Sentry plugin warns `Missing config for organization, project` — set Sentry org/project (or `EXPO_PUBLIC_SENTRY_DSN` + the SENTRY\_\* upload vars) before relying on source-map upload at build time.
- ℹ️ Note: `@sentry/react-native` v7 initializes via JS `Sentry.init()` + an Xcode build phase, so don't expect a literal `SentrySDK.start` edit in `AppDelegate.swift` — confirm Sentry's Xcode build phase appears after `pod install` instead.

**Remaining (needs a real machine + eyes — keep this todo open):**

- [ ] `cd ios && pod install` (watch for MLKit fat-binary patch running) — was skipped here via `--no-install`.
- [ ] `npx expo run:ios` builds and launches in the simulator without errors.
- [ ] Trigger a test error and confirm it reaches Sentry (native crash capture + source maps).
- [x] Document `EXPO_PUBLIC_SENTRY_DSN` (done — `docs/DEV_SETUP.md` "Mobile Client" section; see Updates 2026-05-31 below).

### 2026-05-31 (`EXPO_PUBLIC_SENTRY_DSN` documented — doc AC met; native verification still pending)

Completed via a `/todo` run on this file. The three native-build checkboxes above can't be done by an automated executor (no `ios/` in a worktree, no Xcode/Simulator, no live DSN to test against), so they stay open for a hands-on pass on the main checkout.

- ✅ **Documented `EXPO_PUBLIC_SENTRY_DSN`** in `docs/DEV_SETUP.md` → "Mobile Client" block, as a documented-but-empty entry. Chose DEV_SETUP.md over a literal `.env.example` because no `.env.example` exists in this repo and no tooling copies one to `.env`; DEV_SETUP.md is the project's established tracked env-var documentation (avoids drift). The reporter (`client/lib/reporter.ts`) is a no-op until the DSN is set, so no traffic flows pre-deploy.
- ➕ Also documented the source-map upload companion vars (`SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`, `SENTRY_URL`) — names verified against the installed `@sentry/cli` package. Without them, native crashes still report but stack frames aren't symbolicated.

**Still needs a real machine + eyes (keep this todo `backlog`):**

```bash
# Run from the main checkout (not a worktree — ios/ is gitignored):
cd ios && pod install        # watch for the MLKit fat-binary patch (project_ios26_simulator_fix)
cd .. && npx expo run:ios    # builds + launches in the Simulator
# Then set EXPO_PUBLIC_SENTRY_DSN to a real DSN, trigger a test error,
# and confirm it lands in Sentry (native crash capture + source maps).
```
