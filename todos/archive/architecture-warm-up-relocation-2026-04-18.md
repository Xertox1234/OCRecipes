---
title: "Relocate coach-warm-up session store to storage layer"
status: in-progress
priority: low
created: 2026-04-18
updated: 2026-04-18
labels: [architecture, audit-2026-04-18]
---

# Relocate coach-warm-up session store to storage layer

## Summary

Part of the H9 finding from the 2026-04-18 audit. The main-pass fix replaced the `_internals.store.get(key)` prod access with the public `.get()` API. The second half of H9 — moving the store instance itself from `server/services/` to `server/storage/sessions.ts` — was deferred because it's a broader refactor.

## Background

All other `SessionStore` instances (`analysisStore`, `labelStore`, `cookingSessionStore`, `frontLabelSessionStore`) are created inside `server/storage/sessions.ts` and imported by callers. `coach-warm-up.ts` in `services/` is the outlier — it instantiates its own store + imports `createSessionStore` from storage.

Per `docs/patterns/architecture.md`, session stores are a storage concern. The coach-specific orchestration (generate warmUpId, cacheKey, composite keying) can stay in `services/`, but the store instance itself should move.

## Acceptance Criteria

- [ ] `warmUpStore` instance created in `server/storage/sessions.ts`
- [ ] `services/coach-warm-up.ts` imports the instance (not `createSessionStore`)
- [ ] No other services import `createSessionStore` directly

## Implementation Notes

The store type `WarmUp` is domain-specific (has `warmUpId`, `conversationId`, `messages`). Either:

- Move the type to `shared/` (cleanest, but widens the shared surface), or
- Keep the type in `services/coach-warm-up.ts` and pass it as a generic to `createSessionStore` inside `storage/sessions.ts`

Second option is lower churn.

## Updates

### 2026-04-18

- Created from 2026-04-18 audit deferral (H9 partial).
