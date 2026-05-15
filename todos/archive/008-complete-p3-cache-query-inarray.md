---
status: complete
priority: p3
issue_id: "008"
tags: [performance, backend, database, drizzle]
dependencies: []
---

# Use inArray for efficient cache query

## Problem Statement

Cache lookup queries ALL non-expired entries then filters in JavaScript. Inefficient for large datasets - should filter in database using `inArray`.

## Findings

- Location: `server/services/nutrition-lookup.ts:81-100`
- Current: fetches all valid cache entries, filters in JS
- Problem: scales poorly with cache size
- Solution: use database-level filtering with inArray

## Proposed Solutions

### Option 1: Use Drizzle's inArray operator

- **Pros**: Database does filtering, much more efficient
- **Cons**: None
- **Effort**: Small
- **Risk**: Low

```typescript
import { inArray } from "drizzle-orm";

const cached = await db
  .select()
  .from(nutritionCache)
  .where(
    and(
      inArray(nutritionCache.queryKey, normalizedKeys),
      gt(nutritionCache.expiresAt, now),
    ),
  );
```

## Recommended Action

Implement Option 1 - use inArray for database-level filtering.

## Technical Details

- **Affected Files**: `server/services/nutrition-lookup.ts`
- **Related Components**: Nutrition cache lookup
- **Database Changes**: No (query optimization only)

## Resources

- Original finding: Code review (code-simplicity-reviewer)
- Drizzle docs: inArray operator

## Acceptance Criteria

- [ ] Import `inArray` from drizzle-orm
- [ ] Replace JS filtering with database WHERE clause
- [ ] Query uses inArray with normalizedKeys array
- [ ] Query still filters by expiresAt
- [ ] Performance improved for batch lookups
- [ ] Tests pass
- [ ] Code reviewed

## Work Log

### 2026-02-01 - Approved for Work

**By:** Claude Triage System
**Actions:**

- Issue approved during triage session
- Status: ready
- Ready to be picked up and worked on

**Learnings:**

- Push filtering to database level when possible
- Drizzle's inArray is efficient for batch lookups

## Notes

Source: Triage session on 2026-02-01
