---
title: "Deep-link hardening: resume unauthenticated links after login; chat/recipe-chat invalid-id handling"
status: done
priority: medium
created: 2026-05-29
updated: 2026-05-29
assignee:
labels: [reliability, react-native, deferred]
github_issue:
---

# Deep-link hardening (M2, L2)

## Summary

Two deep-link edge cases from the 2026-05-29 reliability audit that were deferred from the surgical fix set (the related H4 notebook fix landed in the audit).

## Background

- **M2 (Medium):** an unauthenticated deep link is dropped, not queued/resumed after login. The logged-out navigator tree (`client/navigation/RootStackNavigator.tsx`) renders only `Login`, so a link to a `Main` screen can't resolve and is lost.
- **L2 (Low, benign):** `linking.ts` `parseIntOrZero` coerces a malformed `chat/:id` / `recipe-chat/:id` to `0`, so a garbage link opens a blank NEW chat instead of the intended conversation (`linking.ts:19,35`; `RecipeChatScreen.tsx:157` `?? null` doesn't catch `0`). No data-loss harm (unlike the notebook H4 case), so it's acceptable graceful degradation today.

## Acceptance Criteria

- [x] **M2:** an unauthenticated deep link is resumed after login (lands on the intended screen, not dropped).
- [x] **L2 (won't-fix):** the new-chat fallback for a malformed `chat/:id` or `recipe-chat/:id` link is explicitly accepted as correct UX — opening a new chat is a safe, non-destructive degradation path with no data-loss risk (unlike the H4 notebook case). No code change needed.

## Implementation Notes

- **M2 better-fix (Phase 2.5 docs-researcher):** React Navigation v7 ships `<Stack.Navigator UNSTABLE_routeNamesChangeBehavior="lastUnhandled">`, which auto-retries the last unhandled deep link when the authenticated screens appear after login — no custom link queue needed. **Verify the prop exists in the installed `@react-navigation/native-stack` version's types before adding** (it's an `UNSTABLE_`-prefixed prop; the audit could not confirm the installed type defs). If unavailable, fall back to a small read-and-clear pending-link queue resumed on `isAuthenticated` flip.
- **L2:** the chat screens treat a falsy/`0` id as "start new" — the same conflation H4 fixed in the notebook screen, but the new-chat fallback is arguably correct UX for a chat. If fixing, distinguish a provided-but-invalid id (`linking.ts` coerces garbage → `0`, a _defined_ value) from an omitted param and render not-found.

## Dependencies

- None.

## Risks

- `UNSTABLE_`-prefixed RN-nav prop may change across minor versions; pin/verify.

## Updates

### 2026-05-29

- Created from the reliability audit (M2 deferred — experimental-prop fix; L2 deferred — benign). H4 (the high-harm notebook sibling) was fixed in the audit.
