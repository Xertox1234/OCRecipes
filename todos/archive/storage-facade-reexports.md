---
title: "Re-export storage sub-module types through facade"
status: in-progress
priority: medium
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [architecture, encapsulation]
---

# Re-export storage sub-module types through facade

## Summary

5 route files reach directly into storage sub-modules (`storage/users.ts`, `storage/batch.ts`, `storage/sessions.ts`) instead of going through `storage/index.ts`. Re-export needed types and constants through the facade.

## Background

The storage layer uses a facade pattern (`storage/index.ts`) to compose 13 sub-modules. Direct sub-module imports break this encapsulation.

## Acceptance Criteria

- [ ] `UpdatableUserFields` type re-exported (or moved to `@shared/types/`)
- [ ] `BatchStorageError` re-exported through facade
- [ ] `MAX_IMAGE_SIZE_BYTES` re-exported through facade
- [ ] `frontLabelSessionStore` and `createSessionStore` re-exported through facade
- [ ] No route files import directly from `storage/*.ts` sub-modules

## Updates

### 2026-04-07
- Identified in full audit #6 (M5)
