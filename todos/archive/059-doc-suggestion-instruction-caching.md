---
title: "Document suggestion/instruction caching system in project docs"
status: done
priority: low
created: 2026-02-08
updated: 2026-02-08
assignee:
labels: [documentation, caching]
---

# Document Suggestion/Instruction Caching System

## Summary

The caching layer for nutrition lookups, AI suggestions, and instructions is undocumented. Explore and add to DATABASE.md and ARCHITECTURE.md.

## Background

Three cache tables exist (nutritionCache, suggestionCache, instructionCache) with TTL expiration, hit counting, and profile-hash-based keys. None are documented.

## Acceptance Criteria

- [x] Document nutritionCache table (queryKey, TTL, hit counting) in DATABASE.md
- [x] Document suggestionCache table (per-item per-user, profileHash) in DATABASE.md
- [x] Document instructionCache table (per-suggestion drill-down) in DATABASE.md
- [x] Document caching strategy and cache-first patterns in ARCHITECTURE.md
- [x] Document profile-hash based cache invalidation

## Implementation Notes

Key files to explore:

- `shared/schema.ts` — nutritionCache, suggestionCache, instructionCache tables
- `server/utils/profile-hash.ts` — hash generation for cache keys
- `server/storage.ts` — cache read/write methods
- `server/routes.ts` — how suggestion and instruction endpoints use cache
