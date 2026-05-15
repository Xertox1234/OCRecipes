---
title: "P2: Cache Spoonacular catalog detail responses"
status: backlog
priority: medium
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [performance, p2, meal-plan]
---

# P2: Cache Spoonacular catalog detail responses

## Summary

Every request to `/api/meal-plan/catalog/:id` makes a fresh Spoonacular API call, even for the same recipe. The save endpoint also re-fetches details that were likely just previewed. This wastes API quota (150 points/day on free tier).

## Background

`server/services/recipe-catalog.ts:198-224` — no caching layer. 50 users browsing recipes could exhaust the quota within minutes.

## Acceptance Criteria

- [ ] Add in-memory or database cache for catalog detail responses (keyed by Spoonacular ID)
- [ ] Set TTL of 1 hour
- [ ] Reduce duplicate API calls on preview → save flow
- [ ] Add cache hit/miss logging

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
