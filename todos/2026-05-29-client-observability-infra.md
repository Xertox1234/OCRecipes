---
title: "Client observability: off-device error reporter + client logger + wire QueryCache/background-work logging"
status: backlog
priority: high
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, observability, deferred]
github_issue:
---

# Client observability infrastructure

## Summary

There is no off-device error reporter and no client logger; `ErrorBoundary` is mounted with no `onError`, `QueryCache.onError` only toasts, and client `void`/`__DEV__` logging vanishes in prod. Prod client failures are currently invisible. Wire a reporter + a thin client logger and route the existing failure paths into them.

## Background

From the 2026-05-29 reliability audit (Class 10, observability cluster). Findings:

- **C3 (Critical):** no off-device error reporter (`package.json`); `<ErrorBoundary>` mounted with no `onError` (`client/App.tsx:95`, `client/components/ErrorBoundary.tsx:32`).
- **H7 (High):** no client logger module; `console.*`/`__DEV__`-gated logs (e.g. `client/screens/ScanScreen.tsx:304`) vanish in prod bundles.
- **M6 (Medium):** global `QueryCache.onError` (`client/lib/query-client.ts:191`) fires a toast only — no log/report.
- **M7 (Medium):** client `void` background work + anonymous `catch {` (`client/context/BatchScanContext.tsx:136,177,227,281`) logs nothing on failure.

M6/M7 were pulled out of the audit's surgical fix set because a console-only fix is the exact anti-pattern Class 10 flags — they depend on H7/C3 landing first.

## Acceptance Criteria

- [ ] An off-device error reporter is added and wired into `ErrorBoundary.onError` + `QueryCache.onError`.
- [ ] A thin client logger module exists (dev → console; prod → forward to reporter / breadcrumb) replacing `__DEV__`-gated `console.*`.
- [ ] `QueryCache.onError` reports/logs alongside the existing toast (do NOT add a `MutationCache.onError` — see client-state rules).
- [ ] `BatchScanContext` background work captures the error (`catch (err)`, not `catch {`) and logs it.

## Implementation Notes

- **Doc-recommended (Phase 2.5 docs-researcher):** `@sentry/react-native` is the current first-party choice for Expo (`sentry-expo` is superseded); use the Expo config plugin (`withSentry`). Source maps via `@sentry/expo-upload-sourcemaps`.
- **No production deployment yet** (memory `project_no_production_deployment`): the _wiring_ (onError → stub that `console.error` in dev / `captureException` in prod) is a few lines and cheap to add now without a live DSN; supply the DSN at deploy time. Adding the reporter later WITHOUT the wiring means a second touch to every call site.
- Fix order: C3 (reporter + wiring) → H7 (client logger) → M6/M7 (route existing paths through the logger).

## Dependencies

- C3 reporter choice should account for no-prod-yet (pick, wire stub, defer DSN).

## Risks

- Reporter SDK + Expo config plugin touches the native build config — verify iOS/Android build after adding.

## Updates

### 2026-05-29

- Created from the reliability audit (C3/H7/M6/M7). M6/M7 moved here from the surgical set because they require the client logger/reporter first.
