---
title: "Dev-tooling npm advisories (compression, shell-quote, braces, image-size, node-forge, source-map-js, sprintf-js, uuid, ws — Expo/RN chain)"
status: backlog
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

- [ ] Each advisory is either bumped (lockfile-only where in range) or recorded as accepted with its reachability
- [ ] `npm audit --omit=dev` re-run and the remaining list noted in the PR

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
