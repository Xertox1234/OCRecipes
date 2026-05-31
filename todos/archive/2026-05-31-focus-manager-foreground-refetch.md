---
title: "Decide: wire TanStack focusManager to AppState for foreground refetch"
status: done
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [reliability, react-native, client-state, deferred]
github_issue:
---

# focusManager foreground-refetch wiring

## Summary

TanStack Query v5 React Native recommends wiring `focusManager` to `AppState` so queries refetch when the app returns to the foreground. PR #290 deliberately left this unwired — `refetchOnWindowFocus: false` is the current explicit setting. This todo tracks the decision to revisit or close as won't-fix.

## Background

PR #290 wired `onlineManager` to NetInfo (reconnect refetch). The companion recommended by TanStack RN docs is:

```ts
import { AppState } from "react-native";
import { focusManager } from "@tanstack/react-query";
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (state) =>
    handleFocus(state === "active"),
  );
  return () => sub.remove();
});
```

The PR's code review surfaced this as a related gap. It was left unwired because `refetchOnWindowFocus: false` in `QueryClientConfig` is a deliberate choice — possibly to avoid refetch storms on every foreground event. Before implementing, the reasoning behind the existing `false` setting should be understood (whether it was intentional or a default copied from web patterns).

## Acceptance Criteria

- [ ] **Option A — Wire it:** `focusManager.setEventListener` wired in `client/lib/query-client.ts` or `client/App.tsx`; `refetchOnWindowFocus` default left as-is (TanStack respects it); existing tests stay green (no AppState mock issues).
- [ ] **Option B — Close as won't-fix:** Document in a code comment why `refetchOnWindowFocus: false` is intentional and this is a deliberate divergence from TanStack RN defaults.
- [ ] Either way, the decision is recorded (comment or todo close note).

## Implementation Notes

- Check `client/lib/query-client.ts` for the `refetchOnWindowFocus: false` setting and any comment explaining it.
- If the setting has no explanation, search git log for when it was added.
- If wiring: coordinate with `useNetworkStatus.ts` to avoid competing `AppState` listeners (see PR #290 DEFERRED_WARNINGS — "coordinate with H3 auth-lifecycle work").
- TanStack docs example: https://tanstack.com/query/latest/docs/framework/react/react-native

## Dependencies

- PR #290 merged (onlineManager wired) ✓

## Risks

- If wired without review: could cause unexpected refetch storms on foreground — the existing `refetchOnWindowFocus: false` may have been intentional suppression.

## Updates

### 2026-05-31

- Created from PR #290 review. The focusManager gap was noted as out-of-scope for that PR; this todo tracks the follow-up decision.

### 2026-05-31 — DECISION: Option A (wire it)

- **Decision: Option A — wired `focusManager.setEventListener` to `AppState`** in `client/lib/query-client.ts` (module level, right after the `onlineManager`/NetInfo block). The global `refetchOnWindowFocus: false` default is deliberately left untouched, so foreground refetch stays strictly opt-in per query.
- **Why Option A over B:** Investigation of the `false` setting (git blame) showed it dates to the original "Extracted stack files" commit (ee72b8c2, Jan 22), predating PR #290, with **no explanatory comment** — i.e. a default copied from web QueryClient setup, NOT a deliberate anti-storm suppression. By the todo's own decision rule, a copied default points to wiring it. Option B would have meant documenting a justification for a fiction.
- **Functional impact (not inert):** `useHistoryData.ts` and `useCoachContext.ts` already set per-query `refetchOnWindowFocus: true`, but those opt-ins silently never fired on native because there were no window-focus events. Wiring focusManager makes those existing opt-ins actually refetch on foreground.
- **No competing AppState listener:** `useNetworkStatus.ts` uses NetInfo (not AppState), so there is no conflict. The new listener coexists with the existing AppState subscribers (`useAuth`, `usePendingReminders`, `CoachProScreen`).
- **Storm-safe:** because the global default stays `false`, no global foreground refetch fires; the Risks-section refetch-storm concern is moot.
- The rationale is also recorded as a code comment above the `focusManager.setEventListener` call (satisfies AC bullet 3).
- A pure `appStateToFocus(os, status)` helper was extracted so the mapping is unit-tested against real production code (per `docs/rules/testing.md`).
