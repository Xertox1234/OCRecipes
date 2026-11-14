---
title: "Client placement: move usePurchase out of lib/iap and deleteProofMode out of screens/"
status: backlog
priority: low
created: 2026-11-08
updated: 2026-11-08
assignee:
labels: [architecture, client, iap, auth]
github_issue:
human_led: true
---

# Client placement: move usePurchase out of lib/iap and deleteProofMode out of screens/

## Summary

Two placement leftovers from the 2026-11-08 client architecture audit sit in IAP and account-deletion code, so the owner reviews them rather than an agent: `usePurchase` is a React hook stored in `client/lib/iap/`, and `DeleteAccountModal` imports `deleteProofMode` from a screen's utils file.

## Background

The audit (manifest `docs/audits/2026-11-08-architecture.md`, findings L6 and the auth part of M1) moved every other pure helper out of `client/screens/` so components, hooks and camera code no longer import from screens. These two were held back at triage (owner, 2026-11-08) because they touch in-app purchase and re-authentication paths.

- `client/lib/iap/usePurchase.ts:5` imports `usePremiumContext` from `@/context/PremiumContext` — a hook in the lib layer, which otherwise holds no React hooks.
- `client/components/DeleteAccountModal.tsx:24` imports `deleteProofMode` from `@/screens/SignInMethodsScreen-utils` — the last `components/ → screens/` import in the client.

## Acceptance Criteria

- [ ] `usePurchase` lives in `client/hooks/` (pure IAP helpers may stay in `client/lib/iap/`); every importer and test mock path updated.
- [ ] `deleteProofMode` lives outside `client/screens/` (e.g. `client/lib/` or beside `DeleteAccountModal`), with its tests; `SignInMethodsScreen` imports it from there.
- [ ] `grep -rnE "from ['\"]@/screens/" client/components client/hooks client/camera client/lib client/context` returns no production hits.
- [ ] Pure moves only: no behaviour change; purchase and delete-account flows checked on a device afterwards.

## Implementation Notes

Pure `git mv` moves plus import rewiring, the same way the audit did M1. Check `vi.mock` path strings in tests, which `tsc` does not catch.

## Scope Contract

- **Mechanisms to use:** file moves and import rewiring — nothing new.
- **Files in scope:** `client/lib/iap/usePurchase.ts`, `client/screens/SignInMethodsScreen-utils.ts`, `client/components/DeleteAccountModal.tsx`, their importers and tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Updates

### 2026-11-08

- Filed from the client architecture audit (L6 + M1 auth part), deferred by the owner at triage.
