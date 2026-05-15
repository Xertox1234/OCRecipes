---
title: "Replace `as never` mock casts with typed mock factories"
status: backlog
priority: low
created: 2026-03-28
updated: 2026-03-28
assignee:
labels: [code-quality, testing, typescript]
---

# Replace `as never` mock casts with typed mock factories

## Summary

566 occurrences of `as never` across 33 test files bypass TypeScript's type checking on mock return values. Replace with typed mock factory functions that produce complete objects with sensible defaults.

## Background

When `vi.mocked(storage.getUser).mockResolvedValue(mockUser as never)` is used, TypeScript stops checking whether `mockUser` matches the `User` type. If a new required column is added to the schema (e.g., `emailVerified: boolean`), all existing mocks silently pass despite missing the field. This has already caused subtle test gaps where mocks don't reflect production data shapes.

## Scope

- **33 test files**, **566 occurrences**
- Heaviest files: `auth.test.ts` (53), `grocery.test.ts` (50), `recipes.test.ts` (47), `suggestions.test.ts` (42), `chat.test.ts` (38)
- Lightest files: `api-key-auth.test.ts` (1), `verification.test.ts` (1)

## Acceptance Criteria

- [ ] Mock factory created for each domain type used in tests (`User`, `ScannedItem`, `MealPlanRecipe`, `DailyLog`, `UserProfile`, `GroceryList`, etc.)
- [ ] All `as never` casts in test files replaced with factory calls
- [ ] Factories located in a shared `server/__tests__/factories/` directory
- [ ] Each factory returns a complete object matching the Drizzle `$inferSelect` type
- [ ] Factories accept `Partial<T>` overrides for per-test customization
- [ ] All existing tests pass without modification to assertions
- [ ] Zero `as never` remaining in test files (enforced by ESLint rule or grep check)

## Implementation Notes

### Factory pattern

```typescript
// server/__tests__/factories/user.ts
import type { User } from "@shared/schema";

const defaults: User = {
  id: "1",
  username: "testuser",
  passwordHash: "$2b$10$...",
  tokenVersion: 0,
  onboardingCompleted: false,
  subscriptionTier: "free",
  subscriptionExpiresAt: null,
  avatarUrl: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: null,
};

export function createMockUser(overrides: Partial<User> = {}): User {
  return { ...defaults, ...overrides };
}
```

### Usage in tests

```typescript
// Before (unsafe)
vi.mocked(storage.getUser).mockResolvedValue(mockUser as never);

// After (type-safe)
vi.mocked(storage.getUser).mockResolvedValue(
  createMockUser({ username: "test" }),
);
```

### Recommended execution order

1. Create factories for the most-used types first: `User`, `ScannedItem`, `MealPlanRecipe`, `UserProfile`
2. Migrate the heaviest test files first (`auth`, `grocery`, `recipes`)
3. Work outward to lower-count files
4. Add an ESLint rule or pre-commit grep to prevent new `as never` in test files

### Alternative considered: generic helper

```typescript
function mockReturn<T>(partial: Partial<T>): T {
  return partial as T;
}
```

Rejected because this still hides missing fields — it's just a prettier cast. Factories with explicit defaults are safer because adding a required schema field causes a type error in the factory itself.

## Dependencies

- None

## Risks

- Large surface area (33 files) — best done incrementally per-domain
- Some mocks intentionally return incomplete objects to test error paths (e.g., `null as never`). The `null` cases should use explicit `null` return typing, not factories.
