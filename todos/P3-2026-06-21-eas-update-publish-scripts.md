---
title: "Create EAS Update publish scripts (npm run update:preview / update:production)"
status: backlog
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [deferred, build]
github_issue:
---

# Create EAS Update publish scripts

## Summary

Publishing an OTA update currently requires running `eas update` by hand with three things that are easy to forget and silently break the update. Wrap the correct invocation in `npm run update:preview` / `npm run update:production` so a publish can't be done wrong.

## Background

EAS Update (OTA) shipped 2026-06-21 (commit `65063ea8`) and is verified end-to-end on device. But the raw publish command has three footguns (full detail in the `reference_eas_update_ota` auto-memory):

1. **`EXPO_PUBLIC_*` must be passed inline** — `eas update` inlines them from the **shell** at publish time, NOT from `eas.json`'s build `env`. Forget `EXPO_PUBLIC_DOMAIN` and the OTA bundle points at the wrong/undefined backend → the app breaks after the update, with no error.
2. **`--platform all` fails** (it bundles web; `react-native-web` isn't installed). Must pass explicit platforms.
3. **`--non-interactive` is unsupported**; must use `CI=1`.

The working command today is:

```
CI=1 \
EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com \
EXPO_PUBLIC_SENTRY_DSN=https://bf62b005c5085c50b08ad690c613ded4@o4511605735489536.ingest.us.sentry.io/4511605740142592 \
eas update --branch preview --platform ios --message "..."
```

## Acceptance Criteria

- [ ] `npm run update:preview` publishes to branch `preview` with `CI=1`, the correct `EXPO_PUBLIC_DOMAIN` + `EXPO_PUBLIC_SENTRY_DSN` baked in, and a `--message` passthrough.
- [ ] `npm run update:production` does the same for branch `production`.
- [ ] Scripts publish for **both iOS and Android** (the two native targets), not just iOS — e.g. two `--platform ios` / `--platform android` invocations, or `--platform all` once the web issue is resolved.
- [ ] A clear failure if `--message` is missing (don't publish an unlabeled update).
- [ ] Documented in `CLAUDE.md` → Development Commands.

## Implementation Notes

- Files in scope: `package.json` (`scripts`), `CLAUDE.md` (docs).
- Env values to encode (from `reference_eas_update_ota`): `EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com`, `EXPO_PUBLIC_SENTRY_DSN=https://bf62b005c5085c50b08ad690c613ded4@o4511605735489536.ingest.us.sentry.io/4511605740142592`. Keep preview/production as separate scripts so they can diverge later.
- `--message` passthrough: npm passes extra args after `--` to the script (e.g. `npm run update:preview -- --message "fix login"`), or read `$npm_config_message`.
- This can ship independently of the web/platform decision by using explicit `--platform ios` + `--platform android`. The web fix only matters if you want a single `--platform all`.
- Do NOT run `@sentry/wizard` or `expo prebuild` (committed-native project — see `feedback_no_expo_prebuild_clean`).

## Dependencies

- Soft dependency on the web/`--platform all` decision (`P3-2026-06-21-eas-update-web-platform`) — only if you want single-invocation `--platform all`; otherwise independent.

## Risks

- Low. Workflow convenience/safety; the OTA mechanism itself is already proven.

## Updates

### 2026-06-21

- Split out from `P3-2026-06-21-eas-update-web-platform` so the script work is tracked on its own.

### 2026-06-22 (soft dependency resolved — ready to pick up)

- The sibling `P3-2026-06-21-eas-update-web-platform` MERGED (PR #426): `app.json`
  now sets `platforms: ["ios","android"]`, so `eas update --platform all` excludes
  web (config-verified). That work touched **only `app.json`** (option (a), no
  `package.json` change), so the anticipated `package.json` contention with this
  todo never materialized. This todo is now **fully unblocked** and independent —
  ready for the next `/todo` run. The scripts can still use explicit
  `--platform ios`/`--platform android`, or rely on the now-fixed `--platform all`
  once a human confirms it end-to-end (see `reference_eas_update_ota` GOTCHA 2).
