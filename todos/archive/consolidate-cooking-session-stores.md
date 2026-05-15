---
title: "Consolidate duplicated cooking session types and stores"
status: in-progress
priority: high
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [architecture, duplication]
---

# Consolidate duplicated cooking session types and stores

## Summary

`CookingSession` and `CookingSessionPhoto` interfaces are defined identically in both `server/routes/cooking.ts:67-78` and `server/storage/sessions.ts:239-250`. There are also two independent session store instances — one in each file. The storage facade exports the sessions.ts instance, but cooking.ts uses its own local store.

## Background

Previous audit (M12) moved session stores to `storage/sessions.ts`, but cooking.ts retained its own copies. This creates type drift risk and confusion about which store is authoritative.

## Acceptance Criteria

- [ ] Single `CookingSession` and `CookingSessionPhoto` type definition (in `storage/sessions.ts`)
- [ ] Single cooking session store instance
- [ ] `cooking.ts` imports types and store from `storage/sessions.ts`
- [ ] Remove dead `cookingSessionStore` export from facade if not the canonical one
- [ ] All cooking route tests pass

## Updates

### 2026-04-07

- Identified in full audit #6 (H2)
