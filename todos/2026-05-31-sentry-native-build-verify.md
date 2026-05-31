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
- [ ] `EXPO_PUBLIC_SENTRY_DSN` is documented in `.env.example` (or equivalent) so it's not forgotten at first deployment.
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
