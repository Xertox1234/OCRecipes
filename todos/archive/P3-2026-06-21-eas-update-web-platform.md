---
title: "Resolve eas update --platform all web-export failure (react-native-web missing)"
status: done
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [deferred, build]
github_issue:
---

# Resolve `eas update --platform all` web-export failure

## Summary

`eas update` defaults to `--platform all`, which tries to bundle **web** and fails: `react-native-web` isn't installed, yet `app.json` still lists `web` in its config. Until this is resolved, every OTA publish must pass explicit native platforms (`--platform ios`, `--platform android`).

## Background

EAS Update (OTA) shipped 2026-06-21 (commit `65063ea8`). During setup, `eas update --branch preview` (default `--platform all`) failed with:

```
CommandError: It looks like you're trying to use web support but don't have the
required dependencies installed. Install react-native-web@^0.21.0 ...
```

The web frontend is planned but not built yet ([[project_web_frontend]]), so `react-native-web` was never added — but `app.json`'s `web` config keeps `web` in the export platform set.

## Acceptance Criteria

- [ ] Decide and implement one of: (a) remove `web` from `app.json` until the web client exists, (b) install `react-native-web@^0.21.0`, or (c) standardize on explicit `--platform ios`/`--platform android`.
- [ ] After the fix, OTA publishing covers both native targets without a web-export error.
- [ ] Decision documented (one line in `reference_eas_update_ota` memory + wherever the publish path is described).

## Implementation Notes

- Files in scope: `app.json` (`web` block / platforms), possibly `package.json` (if installing `react-native-web`).
- Removing `web` is the lowest-footprint option today (no web build exists); revisit when the web client work starts.
- Pairs with the publish-scripts todo (`P3-2026-06-21-eas-update-publish-scripts`): the scripts can sidestep this entirely with explicit `--platform ios`/`--platform android`, so this is only blocking if you want single-invocation `--platform all`.
- Do NOT run `@sentry/wizard` or `expo prebuild` (committed-native project — see `feedback_no_expo_prebuild_clean`).

## Risks

- Low. Removing `web` could affect any web-targeted config, but no web build currently consumes it.

## Updates

### 2026-06-21

- Filed alongside EAS Update shipping; split from the original bundled publish-workflow todo so the publish-script work is tracked separately.
