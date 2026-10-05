---
title: "Sign Out stops partway when removing the stored login blob fails — logout() leaves the previous user's cached data and signed-in screen in place while the token is already gone"
status: in-progress
priority: medium
created: 2026-10-02
updated: 2026-10-02
assignee:
labels: [deferred, security, react-native]
github_issue:
human_led: true
---

# logout() stops partway when AsyncStorage.removeItem rejects

## Summary

`logout()` in `client/hooks/useAuth.ts` awaits `AsyncStorage.removeItem(AUTH_STORAGE_KEY)` without a try/catch, unlike `expireSession()` and `deleteAccount()`. If that call rejects, `logout()` rejects before `clearDurableLocalState()` and before the `setState` that signs the user out, and the Settings screen's `void logout()` drops the rejection. Sign Out then appears to do nothing while the in-memory token is already null.

## Background

Noticed by the 2026-10-02 verification run of the `/todo` sweep's deferred warnings (#1213–#1226) and left out of the triage code bundle (#1228) because it is auth code. The security reviewer of the triage docs PR (#1229) then measured it while checking the rewritten teardown rule in `docs/rules/client-state.md:8` against `client/hooks/useAuth.ts`.

Measured by that reviewer with Vitest (jsdom) against the real `useAuth.ts`, with the suite's own module mocks and an AsyncStorage mock whose `removeItem` rejects for the auth key only:

| Row                                 | logout threw | offline queue cleared | query cache cleared | isAuthenticated after |
| ----------------------------------- | ------------ | --------------------- | ------------------- | --------------------- |
| control (no failure)                | no           | yes                   | yes                 | false                 |
| removeItem rejects for the auth key | yes          | no                    | no                  | true                  |

What the user experiences: tapping Sign Out does nothing visible. The device keeps showing the signed-in screens and the previous user's cached data, and their queued offline writes stay stored. The token is already cleared (`tokenStorage.clear()` runs first and never throws, `client/lib/token-storage.ts:40-53`), so every request now goes out without a token and fails with a `NO_TOKEN` 401 (`server/middleware/auth.ts:101`). The client deliberately ignores a 401 on a request that carried no token (`client/lib/query-client.ts:145`), so the session-expiry teardown (`expireSession()`, whose only caller is `client/components/SessionExpiryBridge.tsx:32`) never fires and no "session expired" message appears. The stuck state ends only when `checkAuth()` runs its no-token branch (`client/hooks/useAuth.ts:127-143`: durable sweep, then signed out), which happens on the next return to the foreground (`:243-253`) or the next launch. Measured by the confirmation reviewer of this PR with the real `query-client.ts` and `useAuth.ts`: after the failed logout, nothing cleared it; a simulated foreground resume then signed the user out and cleared the queue. The offline queue refuses to replay without a token (`client/lib/offline-queue-drain.ts:74-75` and `:159`), so no write can leak across accounts.

The trigger is an AsyncStorage write failure (full disk, storage corruption), not attacker input. It is not a regression: the previous wording of the rule ("one guarded block") was not met here either.

All auth work is parked for a human-led best-practices review (owner ruling 2026-09-26), and auth changes are never delegated, so this todo is `human_led: true` like the other auth todos.

## Acceptance Criteria

- [ ] `logout()` wraps `await AsyncStorage.removeItem(AUTH_STORAGE_KEY)` (`client/hooks/useAuth.ts:329`) in its own `try { … } catch {}`, the same per-step guard `expireSession()` (`:348`) and `deleteAccount()` (`:370`) already use, so a rejection can no longer skip `clearDurableLocalState()` or the `setState`.
- [ ] A new test in the existing `describe("logout")` block of `client/hooks/__tests__/useAuth.test.ts` (`:693`) makes `AsyncStorage.removeItem` reject for `AUTH_STORAGE_KEY` only, then asserts that `logout()` resolves, the offline queue and the persisted query cache are cleared, and `isAuthenticated` is false. It fails on the current code and passes after the fix.
- [ ] The existing logout tests still pass, including "still clears local state even if server logout fails" (`:741`) and "still clears auth state if queryClient.clear() throws during logout" (`:764`).
- [ ] The teardown order stays token first, then the auth blob, then `clearDurableLocalState()` — the order `client/hooks/useAuth.ts:328-330` already runs, and the order `docs/rules/client-state.md:8` requires since #1229 rewrote that rule token-first.
- [ ] Reviewed by `security-auditor` and `code-reviewer` before merge.

## Implementation Notes

- The function is `logout` at `client/hooks/useAuth.ts:321-332`. Its only unguarded call that can reject is `AsyncStorage.removeItem(AUTH_STORAGE_KEY)` at `:329`. `tokenStorage.clear()` at `:328` swallows its own storage error by design, so it needs no wrapper.
- Copy the guard shape from `expireSession()` at `:348-357`: one `try { await …; } catch {}` per storage step, then `await clearDurableLocalState();`, then the `setState`.
- For the test, follow the failure-injection pattern of the two existing logout failure tests at `:741` and `:764`. Make the AsyncStorage mock's `removeItem` reject only when called with `AUTH_STORAGE_KEY` (imported from `@/lib/durable-owner`, as `useAuth.ts:17` does), so the durable sweep's own `removeItem` calls still succeed and can be asserted.
- Keep the order: the coach reply's send-time token check (`client/hooks/useChat.ts:522-532`) relies on the token being cleared before the query cache.
- The only caller is `client/screens/SettingsScreen.tsx:236` (`void logout()`). It needs no change once `logout()` cannot reject.
- Leaving the auth blob on disk after a swallowed failure is safe: with no token, the cold-start path signs the user out and runs the durable sweep (pinned by the test at `client/hooks/__tests__/useAuth.test.ts:120`).

## Scope Contract

- **Mechanisms to use:** the per-step `try { … } catch {}` guard the other two teardown paths already use — nothing new.
- **Files in scope:** `client/hooks/useAuth.ts`, `client/hooks/__tests__/useAuth.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None technical. Runs as part of the parked, human-led auth review (owner ruling 2026-09-26).

## Risks

- Auth code with a history of regressions: run the real-module tests and keep the change to the one wrapper.
- A swallowed failure leaves the stale auth blob on disk until the next successful clear. The cold-start no-token path handles it, but re-run that test after the change.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage: first noticed by the verification run (workflow wf_7d969d8d-ce1), measured by the security reviewer of PR #1229, and verified by the orchestrator against `client/hooks/useAuth.ts` and `client/screens/SettingsScreen.tsx`. Auto-filed under the medium tier as `human_led` because all auth work is parked for a human-led review.
