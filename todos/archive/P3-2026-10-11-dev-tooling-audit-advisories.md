---
title: "Dev-tooling npm advisories (compression, shell-quote, braces, image-size, node-forge, source-map-js, sprintf-js, uuid, ws — Expo/RN chain)"
status: done
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security, dependencies]
github_issue:
---

# Dev-tooling npm advisories (compression, shell-quote, braces, image-size, node-forge, source-map-js, sprintf-js, uuid, ws — Expo/RN chain)

## Summary

`npm audit --omit=dev` still reports compression (DoS) and shell-quote (critical, quote() injection) plus the Expo/RN toolchain chain; all reach only dev tooling, not the production server.

## Background

Auth audit 2026-10-10 S2. compression via @expo/cli; shell-quote via drizzle-kit / react-devtools-core. Production server deps were cleared (proxy-addr bumped in S1).

Upgrade-pass audit 2026-10-11 S1 (`npm audit --omit=dev`: 51 = 1 critical / 33 high / 17 moderate) added seven new roots, all through the same toolchain: braces (high, stack-exhaustion DoS), image-size (high, JXL/HEIF/ICNS parser loops), node-forge (high, RSA PKCS#1 v1.5 signature check — via @expo/code-signing-certificates / expo-updates), source-map-js (high, event-loop DoS), ws (high, memory-exhaustion DoS — via metro / @react-native/dev-middleware / @expo/devtools), sprintf-js and uuid (moderate). No `server/` or `shared/` import of any of them (grep). node-forge reaches the tree only through the `expo-updates` CLI (`cli/build/generateCodeSigningAsync.js`, `configureCodeSigningAsync.js`) — the app's runtime build does not import it, and app.json configures no code signing.

Source: auth security audit 2026-10-10 (manifest `docs/audits/2026-10-10-security.md`, local-only); deferred at owner triage 2026-10-11.

## Acceptance Criteria

- [x] Each advisory is either bumped (lockfile-only where in range) or recorded as accepted with its reachability
- [x] `npm audit --omit=dev` re-run and the remaining list noted in the PR

## Implementation Notes

- Lockfile-only bumps (`npm update <pkg> --package-lock-only`) — never `npm install` in the shared main checkout while executors run.

## Scope Contract

- **Mechanisms to use:** existing patterns in the files below — nothing new beyond what an acceptance criterion needs
- **Files in scope:** `package-lock.json`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None

## Risks

- Auth code: never delegate to cheap workers; review with security-auditor.

## Updates

### 2026-10-11

- Initial creation (deferred from the auth security audit)
- Upgrade-pass audit S1: seven new root advisories added to scope (braces, image-size, node-forge, source-map-js, sprintf-js, uuid, ws)
- Done: lockfile-only bumps cleared compression 1.8.1→1.8.2, shell-quote 1.10.0→1.12.0 (the critical), source-map-js 1.2.1→1.2.2, ws 6.2.3→6.2.6 / 7.5.10–11→7.5.13 / 8.21.0→8.22.0. `npm audit --omit=dev`: 51 (1 critical / 33 high / 17 moderate) → 47 (0 / 30 / 17).
- Accepted, with reachability (no `server/`, `shared/`, `client/` or `scripts/` import of any of them):
  - braces (high): no fixed release; reached via micromatch in Metro/Expo CLI globbing of our own repo paths.
  - image-size (high): fix is 2.0.3, but metro pins `^1.0.2` and 1.2.1 is the newest 1.x; metro reads only our own bundled image assets at build time.
  - node-forge (high): only the `expo-updates` CLI code-signing commands; app.json configures no code signing.
  - sprintf-js (moderate): via argparse in istanbul config loading (test tooling).
  - uuid (moderate): via `xcode` (prebuild) and `@expo/ngrok`; only the `buf`-argument path is affected.
  - The remaining 42 entries are the parents of these five (expo, react-native, expo-updates, @sentry/react-native …); their "fix" is a semver-major downgrade npm proposes, not a real fix. They clear at the next Expo SDK upgrade.
