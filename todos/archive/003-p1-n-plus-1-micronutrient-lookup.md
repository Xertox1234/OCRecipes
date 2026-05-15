---
title: "N+1 query in daily micronutrient summary"
status: done
priority: critical
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [performance, code-review, database]
---

# N+1 Query in Daily Micronutrient Summary

## Summary

`server/routes/micronutrients.ts` (lines 74-85) executes a separate DB query AND a separate USDA API call for each daily log entry. A user with 10 logged items triggers 10 DB queries + 10 HTTP requests.

## Background

The `/api/micronutrients/daily` endpoint fetches daily logs, then for each log with a `scannedItemId`, it loads the scanned item individually and calls the USDA API. Response time scales linearly with number of daily food items — O(n) DB queries + O(n) external API calls. At 100x users, USDA rate limits will be hit and DB connection pool may exhaust.

## Acceptance Criteria

- [x] Daily logs joined with scanned items in a single query
- [x] USDA micronutrient lookups cached in database (similar to nutritionCache)
- [x] Response time < 2s for 20 daily items
- [x] External USDA calls only made for items not in cache

## Implementation Notes

- Replace sequential `getScannedItem` calls with a joined query
- Add a `micronutrientCache` table similar to `nutritionCache`
- Use `Promise.all` for any remaining parallel lookups

## Updates

### 2026-02-24

- Found during code review by performance-oracle agent
- Fixed: batch `getScannedItemsByIds` replaces N sequential queries with one `IN` clause
- Fixed: `micronutrientCache` table stores USDA results with 7-day TTL (fire-and-forget writes)
- Fixed: `lookupMicronutrientsWithCache` checks cache before USDA; `batchLookupMicronutrients` runs all in parallel
- Code review: fire-and-forget for hit counts + cache writes, userId defense-in-depth on batch query, made raw USDA lookup private
