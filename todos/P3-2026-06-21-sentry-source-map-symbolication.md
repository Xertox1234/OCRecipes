---
title: "Enable Sentry source-map / dSYM upload (symbolicated stack frames)"
status: backlog
priority: low
created: 2026-06-21
updated: 2026-06-21
assignee:
labels: [observability, deferred]
github_issue:
---

# Sentry symbolication (source maps + debug symbols)

## Summary

Error _delivery_ to Sentry is verified end-to-end (see archived `P2-2026-05-31-sentry-native-build-verify`), but build-time source-map/dSYM upload is still disabled, so captured frames are minified/bytecode positions. Turn on upload so stack traces are symbolicated.

## Background

On 2026-06-21 a `preview` EAS build (`d2a86ad1`) on a real device confirmed a test error reaches the new Sentry project `ocrecipes-wx / ocrecipes-mobile`. To keep that first verification simple and avoid a missing-token build failure, `eas.json` still sets `SENTRY_DISABLE_AUTO_UPLOAD: "true"` in both `preview` and `production`, and no Sentry auth token is configured. The native Sentry Xcode/Gradle upload phases already exist (added by the config plugin); they just need credentials + Metro debug-id wiring to actually upload.

## Acceptance Criteria

- [ ] An **Organization** auth token is created in Sentry (Settings → Developer Settings → Organization Tokens) and added as an EAS secret: `eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value <token>`. It is NOT committed to git.
- [ ] `SENTRY_ORG=ocrecipes-wx` and `SENTRY_PROJECT=ocrecipes-mobile` are available to the build (added to the `preview`/`production` `env` blocks in `eas.json`, or to the `@sentry/react-native/expo` plugin config in `app.json`). `ios/sentry.properties` + `android/sentry.properties` already fall back to these env vars.
- [ ] `metro.config.js` wraps its export with `@sentry/react-native/metro`'s `withSentryConfig` (it currently has no Sentry serializer, so debug IDs aren't emitted into the bundle).
- [ ] `SENTRY_DISABLE_AUTO_UPLOAD` is removed (or set `"false"`) in the `preview` profile in `eas.json` (and `production` once `preview` is proven).
- [ ] A `preview` EAS build uploads source maps + dSYMs without error, and a triggered test error shows **symbolicated** frames (real file/line, not minified) in Sentry.

## Implementation Notes

- Files in scope: `eas.json` (the `preview` + `production` `env` blocks, ~lines 11–26), `metro.config.js`, `app.json` (the `@sentry/react-native/expo` plugin entry, ~line 39), and the two generated `ios/sentry.properties` / `android/sentry.properties` (no edit needed — they read the env vars).
- The public `EXPO_PUBLIC_SENTRY_DSN` is already wired in `eas.json`; this todo only adds the _upload_ credentials/config, not the DSN.
- Do NOT run `npx @sentry/wizard` — it would overwrite the privacy-hardened `client/lib/reporter.ts` (`sendDefaultPii: false` + `Authorization`-header scrub + `__DEV__` gate) and create a duplicate `Sentry.init()`. Wire `withSentryConfig` by hand.
- Verify on `preview` (internal distribution) before flipping `production`, so a bad token can't break a store build.

## Dependencies

- Verified DSN swap on `main` (done 2026-06-21).
- A Sentry organization auth token (user-created; secret).

## Risks

- A missing/invalid `SENTRY_AUTH_TOKEN` fails the build at the upload step — exactly why auto-upload is currently disabled. Test on `preview` first.

## Updates

### 2026-06-21

- Created as the optional follow-up after error-delivery verification completed. Symbolication intentionally deferred from that pass to keep the first verification minimal.
