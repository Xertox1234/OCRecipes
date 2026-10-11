---
title: "Dev-tooling npm advisories (compression, shell-quote, Expo/RN chain)"
status: backlog
priority: low
created: 2026-10-11
updated: 2026-10-11
assignee:
labels: [deferred, security, dependencies]
github_issue:
---

# Dev-tooling npm advisories (compression, shell-quote, Expo/RN chain)

## Summary

`npm audit --omit=dev` still reports compression (DoS) and shell-quote (critical, quote() injection) plus the Expo/RN toolchain chain; all reach only dev tooling, not the production server.

## Background

Auth audit 2026-10-10 S2. compression via @expo/cli; shell-quote via drizzle-kit / react-devtools-core. Production server deps were cleared (proxy-addr bumped in S1).

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
