---
title: Typed mock factories for test data (replaces `as never`)
track: knowledge
category: conventions
module: server
tags: [testing, vitest, mocks, factories, type-safety]
applies_to: [server/**/__tests__/**/*.ts, server/__tests__/factories/**/*.ts]
created: '2026-05-13'
---

# Typed mock factories for test data (replaces `as never`)

## Rule

Use typed factory functions from `server/__tests__/factories/` to create mock data in tests. Each factory returns a complete schema-compliant object and accepts `Partial<T>` overrides. This replaces unsafe `as never` casts, which are now banned by ESLint.

## Examples

```typescript
// server/__tests__/factories/user.ts
import type { User } from "@shared/schema";

const userDefaults: User = {
  id: "1",
  username: "testuser",
  password: "$2b$10$hashedpassword",
  // ... all required fields with sensible defaults
};

export function createMockUser(overrides: Partial<User> = {}): User {
  return { ...userDefaults, ...overrides };
}
```

```typescript
// Usage in tests
import {
  createMockUser,
  createMockUserProfile,
} from "../../__tests__/factories";

// Full default User — all schema fields present
vi.mocked(storage.getUser).mockResolvedValue(createMockUser());

// Override specific fields for the test case
vi.mocked(storage.getUser).mockResolvedValue(
  createMockUser({ subscriptionTier: "premium", dailyCalorieGoal: 2500 }),
);

// "Not found" returns — use undefined (not null) for T | undefined storage functions
vi.mocked(storage.getUser).mockResolvedValue(undefined);
```

```typescript
// ❌ BAD: as never — bypasses type checking, hides schema mismatches
vi.mocked(storage.getUser).mockResolvedValue({
  id: 1,
  username: "test",
} as never);

// ❌ BAD: null for "not found" when storage returns T | undefined
vi.mocked(storage.getUser).mockResolvedValue(null as never);
```

## Available factories

`server/__tests__/factories/index.ts` re-exports all factories organized by domain:

| File                   | Factories                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user.ts`              | `createMockUser`, `createMockUserProfile`                                                                                                                                                                                                              |
| `nutrition.ts`         | `createMockScannedItem`, `createMockDailyLog`, `createMockNutritionData`, `createMockCookedNutrition`, `createMockChatCompletion`, `createMockNutritionCache`, `createMockMicronutrientCache`, `createMockFavouriteScannedItem`                        |
| `recipes.ts`           | `createMockMealPlanRecipe`, `createMockRecipeIngredient`, `createMockMealPlanItem`, `createMockCommunityRecipe`, `createMockRecipeGenerationLog`, `createMockCookbook`, `createMockCookbookRecipe`, `createMockTastePick`, `createMockRecipeDismissal` |
| `grocery.ts`           | `createMockGroceryList`, `createMockGroceryListItem`, `createMockPantryItem`                                                                                                                                                                           |
| `chat.ts`              | `createMockChatConversation`, `createMockChatMessage`                                                                                                                                                                                                  |
| `health.ts`            | `createMockWeightLog`, `createMockHealthKitSync`, `createMockFastingSchedule`, `createMockFastingLog`, `createMockMedicationLog`, `createMockGoalAdjustmentLog`                                                                                        |
| `subscription.ts`      | `createMockTransaction`                                                                                                                                                                                                                                |
| `scan.ts`              | `createMockMenuScan`, `createMockReceiptScan`                                                                                                                                                                                                          |
| `verification.ts`      | `createMockBarcodeVerification`, `createMockVerificationHistory`, `createMockReformulationFlag`, `createMockApiKey`, `createMockApiKeyUsage`, `createMockBarcodeNutrition`                                                                             |
| `cache.ts`             | `createMockSuggestionCache`, `createMockInstructionCache`, `createMockMealSuggestionCache`                                                                                                                                                             |
| `saved-item.ts`        | `createMockSavedItem`                                                                                                                                                                                                                                  |
| `favourite-recipes.ts` | `createMockFavouriteRecipe` (verify against `server/__tests__/factories/favourite-recipes.ts`)                                                                                                                                                         |
| `reminders.ts`         | `createMockPendingReminder`, `createMockPushToken`                                                                                                                                                                                                     |

## When this applies

Any test that mocks a storage function or service returning a domain object.

## Exceptions

Mocking simple primitives (`true`, `0`, `[]`) or `undefined` — these don't need a factory.

## Why this matters

When a schema column is added, renamed, or removed, the factory's defaults produce a compile error — the single place to fix. Without factories, 583+ mock sites silently pass with incomplete objects, and type mismatches only surface in production.

## Adding a new factory

When a new table is added to `shared/schema.ts`, add a factory to the appropriate domain file (or create a new file) and re-export from `index.ts`. Fill in all required fields with sensible defaults.

## Related Files

- `server/__tests__/factories/index.ts` — barrel export
- `server/__tests__/factories/*.ts` — per-domain factory modules

## See Also

- [ESLint ban on `as never` in tests](../best-practices/eslint-ban-as-never-in-tests-2026-05-13.md)
- [Storage return types: `undefined` for "not found"](storage-return-types-undefined-not-found-2026-05-13.md)
