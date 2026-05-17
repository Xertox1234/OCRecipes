---
title: "Vitest global setup clears mock history but not implementations — leak risk"
status: done
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, testing]
github_issue:
---

# Vitest global setup clears mock history but not implementations — leak risk

## Summary

`test/setup.ts` runs `vi.clearAllMocks()` in a global `beforeEach`. `clearAllMocks` clears call history only — it does NOT reset `.mockImplementation()` / `.mockResolvedValueOnce()` overrides. A test that overrides a module-singleton mock can leak that implementation into later tests in the same worker file.

## Background

Audit finding L4 from `docs/audits/2026-05-16-testing.md` (testing-setup audit, 2026-05-16).

The alias mocks under `test/mocks/` export module-singleton `vi.fn()`s — e.g. `impactAsync`, `notificationAsync`, `selectionAsync` in `test/mocks/expo-haptics.ts:18-20`, and `useReducedMotion` in `test/mocks/react-native-reanimated.ts`. If a test calls `.mockImplementation()` / `.mockResolvedValueOnce()` directly on one of these singletons, the override survives the global `vi.clearAllMocks()` and is still active when the next test runs in the same worker.

This is **latent, not an active bug**: the two files that currently override `useReducedMotion` (`useHaptics.test.ts`, `useAccessibility.test.ts`) each call `vi.restoreAllMocks()` in their own `afterEach` with an inline comment explaining why. The risk is a _future_ test author overriding a singleton without that local cleanup.

Phase 2.5 docs-researcher validated this against current Vitest docs (verdict: `confirmed`):

- `vi.clearAllMocks()` (≡ config `clearMocks: true`) — clears `.mock.calls/instances/results` only; implementation untouched.
- `vi.resetAllMocks()` (≡ config `mockReset: true`) — clears history AND resets implementation to the `vi.fn(impl)` constructor arg.
- `vi.restoreAllMocks()` (≡ config `restoreMocks: true`) — reset + un-spy for `vi.spyOn` mocks; for plain `vi.fn()` it is identical to `mockReset`.
- Doc-recommended global fix: set `mockReset: true` in `vitest.config.ts` (https://main.vitest.dev/config/mockreset).

## Acceptance Criteria

- [x] Decide the fix: `mockReset: true` in `vitest.config.ts` (doc-recommended) vs. swapping the `beforeEach` in `test/setup.ts` to `vi.resetAllMocks()`. — chose neither global option; scoped per-singleton `.mockReset()` instead (AC's "or scope the change" path).
- [x] Apply the chosen change.
- [x] Full `npm run test:run` passes — confirm no test relied on a _persisted_ mock implementation (one set in a `vi.mock` factory, `beforeAll`, or module scope and never re-applied per test).
- [x] If tests break, triage: fix the dependent tests to set up their implementation per-test, or scope the change. Do not mask the failure. — global `mockReset` broke 72 tests relying on `vi.mock()` factory defaults; scoped the change to the L4 leak surface instead.
- [x] If `mockReset: true` is adopted, evaluate whether the manual `beforeEach` in `test/setup.ts` and the per-file `restoreAllMocks()` workarounds in `useHaptics.test.ts` / `useAccessibility.test.ts` can be removed. — `mockReset: true` not adopted; per-file `restoreAllMocks()` workarounds evaluated and kept (they un-install `vi.spyOn` spies, which `.mockReset()` does not do).

## Implementation Notes

Files in scope:

- `test/setup.ts:31-33` — the global `beforeEach(() => vi.clearAllMocks())`.
- `vitest.config.ts` — `test` block currently sets none of `clearMocks` / `mockReset` / `restoreMocks`.
- `test/mocks/expo-haptics.ts`, `test/mocks/react-native-reanimated.ts` — the singleton `vi.fn()` exporters.
- `client/hooks/__tests__/useHaptics.test.ts`, `client/hooks/__tests__/useAccessibility.test.ts` — current per-file `restoreAllMocks()` workarounds.

This is a deliberate global test-infra change affecting all 5,191 tests. It is NOT a drive-by — it needs a full-suite run and per-failure triage. That is why the 2026-05-16 testing audit deferred it rather than fixing inline.

## Dependencies

- None.

## Risks

- `mockReset` resets implementations before every test. Any test relying on a mock implementation set once outside a per-test `beforeEach` (in a `vi.mock` factory body, `beforeAll`, or at module scope) will break. The count of such tests across 352 files is unknown until the full suite runs.

## Updates

### 2026-05-16

- Initial creation — deferred from the 2026-05-16 testing-setup audit (finding L4).

### 2026-05-16 — implemented

- Tried the doc-recommended `mockReset: true` global config first. Full-suite
  run showed it breaks 72 tests across 21 files: per-file `vi.mock()` factory
  bodies define `vi.fn().mockResolvedValue(...)` defaults (no constructor-arg
  impl), and `mockReset` wipes those chained defaults back to no-op. That
  pattern is widespread and is NOT the leak surface the audit (L4) named.
- Adopted the AC's "or scope the change" path instead: kept
  `vi.clearAllMocks()` in `test/setup.ts` and added per-singleton
  `.mockReset()` for the `test/mocks/` module singletons named in L4
  (`impactAsync`, `notificationAsync`, `selectionAsync`, `useReducedMotion`).
  Those singletons use the `vi.fn(impl)` form, so `mockReset` restores the
  correct defaults. Full suite stays green (5191/5191).
- Evaluated removing the per-file `restoreAllMocks()` workarounds in
  `useHaptics.test.ts` / `useAccessibility.test.ts` (AC bullet 5): kept them.
  Those tests use `vi.spyOn()`; the global `useReducedMotion.mockReset()`
  resets the spy's implementation but does not un-install the spy. The
  per-file `restoreAllMocks()` is the correct un-spy and remains warranted.
