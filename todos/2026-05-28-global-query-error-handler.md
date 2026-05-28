---
title: "Add a global QueryCache/MutationCache onError net to the TanStack Query client"
status: backlog
priority: high
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [client-state, architecture, error-handling]
github_issue:
---

# Add a global QueryCache/MutationCache onError net to the TanStack Query client

## Summary

`client/lib/query-client.ts:124` constructs the `QueryClient` with `defaultOptions` only — no `QueryCache`/`MutationCache` `onError`. There is no app-wide net that surfaces a failed query/mutation, so any screen that forgets to read `isError` fails silently. Add a global error handler that shows a non-blocking, user-visible message as a backstop.

## Background

This is the structural root cause behind the silent-failure class found during the 2026-05-28 investigation (unsolicited user report: "works except when it doesn't, and when it doesn't it fails quietly"). The per-screen/per-hook todos filed the same day fix individual surfaces; this todo fixes the systemic gap so _new_ screens don't reintroduce the problem. Highest-leverage single change in the set.

## Acceptance Criteria

- [ ] `QueryClient` is constructed with a `QueryCache` whose `onError` surfaces a user-visible, non-blocking message (e.g. a toast).
- [ ] Decide and document the mutation policy (see Implementation Notes) — avoid double-reporting given the ~91 existing local `onError` handlers.
- [ ] Expected/handled cases are excluded from the global net: 401 auth redirects (`on401` flows) and 4xx errors that screens already render.
- [ ] Screens that already show their own error state do not get a duplicate global toast (use `meta` opt-out or scope the net to queries).
- [ ] Existing retry behavior (`client/lib/query-client.ts:131-136`) is preserved.

## Implementation Notes

- Edit `client/lib/query-client.ts:124`: pass `queryCache: new QueryCache({ onError })` (and decide on `mutationCache`).
- **Toast bridge constraint:** `query-client.ts` is module-level code, not inside the React tree, so it cannot call a hook-based toast directly. Surface errors via a module-level event emitter / ref that a top-level component subscribes to and renders (mirror the existing toast usage seen in `client/screens/CookSessionCaptureScreen.tsx:113`).
- **Double-report gotcha:** in TanStack Query v5 the cache-level `onError` fires _in addition to_ each observer's local `onError`. With ~91 existing mutation `onError` handlers, a naive global mutation handler would double-toast. Recommended: scope the global net to **queries** (which mostly lack handlers) and leave mutations to their local handlers, or gate global handling behind a `meta` flag.
- Suppress noise: skip the toast for `4xx` (client errors screens already branch on) and for the `on401: "throw"` / auth-redirect path.

## Dependencies

- Companion to the per-screen silent-failure todos filed 2026-05-28 (daily-nutrition-detail, home-screen, coach-reminders, coach-chat, data-hooks). Those remain worth doing for proper inline error/retry UX; this net is the backstop, not a replacement.

## Risks

- Architectural touch point — affects every query in the app. Validate that already-handled error screens don't get duplicate toasts, and that the auth-redirect path stays quiet.
- Toast spam if multiple queries fail at once (e.g. offline). Consider de-duping/coalescing messages.

## Updates

### 2026-05-28

- Initial creation. Root cause confirmed by reading `client/lib/query-client.ts:124-142` (no `QueryCache`/`MutationCache` `onError`).
