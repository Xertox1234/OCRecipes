---
title: "Quiet iOS Run Script 'ambiguous dependencies' warnings (MLKit patch + Sentry upload)"
status: backlog
priority: low
created: 2026-06-02
updated: 2026-06-02
assignee:
labels: [deferred, ios, build]
github_issue:
---

# Quiet the iOS build-phase "ambiguous dependencies" warnings

## Summary

Two iOS Run Script build phases warn that they run on **every** build because Xcode can't analyze their dependencies. Minor build-time noise / wasted rebuild work — not a failure.

## Background

Surfaced during the 2026-06-02 Sentry native-build attempt (see [[P2-2026-05-31-sentry-native-build-verify]]). Xcode emitted:

```
⚠️  Script has ambiguous dependencies causing it to run on every build.
    To fix, go to: Xcode » OCRecipes/OCRecipes » Build Phases » '[MLKit] Patch for platform'
⚠️  Script has ambiguous dependencies causing it to run on every build.
    To fix, go to: Xcode » OCRecipes/OCRecipes » Build Phases » 'Upload Debug Symbols to Sentry'
```

Both phases lack declared input/output file lists, so Xcode re-runs them unconditionally.

## Acceptance Criteria

- [ ] Both Run Script phases either declare input/output files or set `alwaysOutOfDate` intentionally, so the "ambiguous dependencies" warning stops.
- [ ] The fix survives a future `expo prebuild` / `pod install` (see Implementation Notes — both phases are generated, not hand-authored).

## Implementation Notes

- **Caveat (the real reason this is non-trivial):** both phases are _generated_ — the `[MLKit] Patch for platform` phase is added by the Podfile `post_install` hook (`ios/Podfile`), and "Upload Debug Symbols to Sentry" is added by the `@sentry/react-native/expo` config plugin. Editing them directly in Xcode would be wiped on the next prebuild/pod install. The fix must be made where the phase is generated: the Podfile hook for MLKit, and (for Sentry) accept that it's plugin-controlled — likely **WONTFIX** for the Sentry one unless the plugin exposes an option.
- These scripts arguably _should_ run most builds anyway (the MLKit patch re-tags binaries per-target; the Sentry phase uploads debug symbols), so the perf cost is low. Weigh effort vs. value before doing this.
- Files in scope: `ios/Podfile`, `scripts/patch-mlkit-simulator.py`.

## Dependencies

- Practically gated behind [[P1-2026-06-02-ios-build-nitromodules-jsi-failure]] (no point tuning build phases while the build can't complete), but not a hard dependency.

## Risks

- Low. Editing the Podfile `post_install` hook risks the MLKit patch wiring if done carelessly (memory `project_ios26_simulator_fix`).

## Updates

### 2026-06-02

- Created from the Sentry build attempt. Disposable / possibly WONTFIX for the Sentry-plugin phase.
