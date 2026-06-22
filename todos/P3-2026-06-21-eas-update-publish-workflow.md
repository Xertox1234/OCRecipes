---
title: "Harden the EAS Update publish workflow (web-export failure + env/platform footguns)"
status: backlog
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [deferred, build]
github_issue:
---

# Harden the EAS Update publish workflow

## Summary

EAS Update (OTA) shipped 2026-06-21 (commit `65063ea8`), verified end-to-end on device. But publishing an update by hand has three footguns that are easy to get wrong and produce silent breakage. Wrap them in npm scripts so a publish can't be done incorrectly.

## Background

`eas update` was run by hand during setup. Three sharp edges surfaced:

1. **`--platform all` fails** — it tries to bundle **web**, but `react-native-web` isn't installed and `app.json` still lists `web` in its config. Every publish currently must pass `--platform ios` explicitly (Android would need a separate `--platform android`).
2. **`EXPO_PUBLIC_*` are inlined from the shell at publish time**, NOT from `eas.json`'s build `env`. Forget to pass `EXPO_PUBLIC_DOMAIN` and the OTA bundle points at the wrong/undefined backend → the app breaks after the update, with no build error.
3. **`--non-interactive` is unsupported** by the underlying expo export; you must use `CI=1`.

See the `reference_eas_update_ota` auto-memory for the full incantation.

## Acceptance Criteria

- [ ] Decide and implement the web-platform fix: either (a) remove `web` from `app.json` platforms until the web frontend exists, or (b) install `react-native-web`, OR (c) standardize on explicit `--platform` flags. Document the choice.
- [ ] Add `npm run update:preview` and `npm run update:production` scripts that publish with `CI=1`, the correct `EXPO_PUBLIC_DOMAIN`/`EXPO_PUBLIC_SENTRY_DSN`, and the right platform(s) baked in — so the env/platform footguns can't be forgotten. Accept a `--message` passthrough.
- [ ] Updates publish for **both** iOS and Android (the two native targets), not just iOS.
- [ ] Scripts documented in `CLAUDE.md` Development Commands and/or `docs/`.

## Implementation Notes

- Files in scope: `package.json` (scripts), `app.json` (`web` / platforms), possibly `docs/`.
- The publish env that must be encoded: `EXPO_PUBLIC_DOMAIN=https://api.ocrecipes.com` + `EXPO_PUBLIC_SENTRY_DSN=https://bf62b005c5085c50b08ad690c613ded4@o4511605735489536.ingest.us.sentry.io/4511605740142592`. Preview and production point at the same prod backend today; keep them as separate scripts so they can diverge.
- Do NOT run `@sentry/wizard` or `expo prebuild` (committed-native project — see `feedback_no_expo_prebuild_clean`).
- For two-platform publishing without web: either `--platform ios` + `--platform android` as two invocations, or resolve the web dep so `--platform all` works.

## Risks

- Low. This is workflow hardening; the OTA mechanism itself is already proven.

## Updates

### 2026-06-21

- Filed immediately after EAS Update shipped, capturing the publish footguns observed during manual verification.
