---
title: "P1: Escape ILIKE wildcard characters in community recipe search"
status: backlog
priority: high
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [security, performance, p1, meal-plan]
---

# P1: Escape ILIKE wildcard characters in community recipe search

## Summary

The `getCommunityRecipes` ILIKE pattern doesn't escape `%` and `_` metacharacters, allowing pattern injection that broadens search results or forces full table scans.

## Background

`server/storage.ts:607-619` — `normalizedProductName` is interpolated into `%${normalizedProductName}%` without escaping. While Drizzle parameterizes the value (not raw SQL injection), `_` acts as a single-character wildcard and `%` as multi-character wildcard in LIKE patterns.

## Acceptance Criteria

- [ ] Create `escapeLike()` utility that escapes `%`, `_`, and `\` characters
- [ ] Apply to `getCommunityRecipes` ILIKE pattern
- [ ] Add unit tests for the escape function
- [ ] No regressions on tests

## Implementation Notes

```typescript
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

// Usage:
ilike(
  communityRecipes.normalizedProductName,
  `%${escapeLike(normalizedProductName)}%`,
);
```

## Dependencies

- None

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
