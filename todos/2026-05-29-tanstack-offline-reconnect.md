---
title: "Wire TanStack Query onlineManager + reconnect refetch / mutation resume"
status: backlog
priority: medium
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, react-native, client-state, deferred]
github_issue:
---

# TanStack offline/reconnect wiring (H2)

## Summary

`client/lib/query-client.ts` never wires TanStack Query's `onlineManager` to NetInfo, and mutations are `retry: false` with no resume-on-reconnect. NetInfo is used **display-only** (`useNetworkStatus.ts` → OfflineBanner), so queries don't refetch on reconnect and in-flight scans are lost on disconnect — the "Back online" toast misleads.

## Background

Reliability audit Class 4 (network-state transitions), High. Deferred from the surgical fix set because: wiring `NetInfo.addEventListener` at module load in the widely-imported `query-client.ts` would break the many tests that import it (the global `test/setup.ts` does **not** mock NetInfo), and the durable mutation-resume needs the async-storage persister — both beyond a surgical audit edit and unverifiable without running the app.

## Acceptance Criteria

- [ ] `onlineManager.setEventListener` is wired to NetInfo so TanStack's online flag reflects real connectivity.
- [ ] Queries that failed offline refetch on reconnect (the existing `refetchOnReconnect` default activates once `onlineManager` is wired).
- [ ] Paused mutations resume on reconnect (`queryClient.resumePausedMutations()`), or an explicit decision that they shouldn't.
- [ ] A global NetInfo mock added to `test/setup.ts` (or the wiring placed where unit tests don't import it) so the existing suite stays green.

## Implementation Notes

- **Doc-recommended (Phase 2.5 docs-researcher), TanStack Query v5 React Native:**
  ```ts
  import NetInfo from "@react-native-community/netinfo";
  import { onlineManager } from "@tanstack/react-query";
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(!!state.isConnected)),
  );
  onlineManager.subscribe((isOnline) => {
    if (isOnline) queryClient.resumePausedMutations();
  });
  ```
- Decide wiring location: a once-rendered root (`App.tsx` `useEffect`) avoids the module-load-in-query-client test problem, OR add a global NetInfo mock to `test/setup.ts`.
- Durable resume across app restarts (persist paused mutations) needs `@tanstack/query-async-storage-persister` — larger; can be a follow-up.
- Related (separate) gap the researcher noted: `focusManager` not wired to `AppState` for foreground refetch — `refetchOnWindowFocus: false` is currently a deliberate choice; decide separately.

## Dependencies

- None blocking; coordinate with the H3 auth-lifecycle work (`AppState` foreground handling) so the two don't add competing `AppState` listeners.

## Risks

- Introduces connectivity-driven refetch/resume behavior — verify in-app (offline → online) that it doesn't cause unexpected refetch storms; the global `QueryCache.onError` toast dedups, but confirm.

## Updates

### 2026-05-29

- Created from the reliability audit (H2). Deferred from the surgical set: touches test infra + runtime reconnect behavior not verifiable in the audit.
