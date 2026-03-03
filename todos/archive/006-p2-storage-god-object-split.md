---
title: "Split storage.ts god object (2,386 lines, 90+ methods)"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [architecture, code-review, refactor]
---

# Split storage.ts God Object

## Summary

`server/storage.ts` is 2,386 lines with 90+ methods spanning 15+ domains (users, nutrition, meal plans, exercises, chat, fasting, medication, etc.). Every new feature adds more methods to this single class.

## Background

The `IStorage` interface (391 lines) + `DatabaseStorage` implementation (1,889 lines) constitutes a textbook God Object anti-pattern. Found by architecture, patterns, and simplicity reviewers. The `IStorage` interface only has one implementation and no tests use an alternative — it's YAGNI.

## Acceptance Criteria

- [ ] Storage split into domain-specific modules (e.g., storage/user.ts, storage/nutrition.ts, etc.)
- [ ] Central storage/index.ts composes and re-exports all methods
- [ ] IStorage interface removed (or split into sub-interfaces)
- [ ] All existing tests pass
- [ ] Date range helper extracted (duplicated 8 times at lines 735, 768, 855, 1028, 1643, 1754, 1983, 2239)

## Implementation Notes

- Suggested domains: UserRepository, NutritionRepository, MealPlanRepository, ActivityRepository, ChatRepository, CacheRepository
- Remove IStorage interface entirely — TypeScript structural typing handles mocking
- Extract `getDayBounds(date: Date)` utility for the 8 duplicated date range blocks

## Updates

### 2026-02-24
- Found by architecture-strategist, pattern-recognition, and code-simplicity reviewers
