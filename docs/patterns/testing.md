# Testing Patterns

### Pure Function Extraction for Vitest Testability

When a React Native hook or component contains business logic that you want to unit test, extract the pure functions into a separate `*-utils.ts` file that does **not** import from `react-native`, `expo-*`, or any native module. Vitest runs in Node via Vite/Rollup, which cannot parse React Native's JSX runtime or native module bindings.

```
# File structure
client/lib/iap/
  usePurchase.ts          # Hook — imports React Native, not directly testable in Vitest
  purchase-utils.ts       # Pure functions — no RN imports, fully testable
  __tests__/
    usePurchase.test.ts   # Tests import from purchase-utils.ts only

client/components/
  UpgradeModal.tsx        # Component — imports React Native
  upgrade-modal-utils.ts  # Pure functions — BENEFITS array, getCtaLabel(), isCtaDisabled()
```

```typescript
// purchase-utils.ts — Pure, no React Native imports
import type { PurchaseError } from "@shared/types/subscription";
import type { UpgradeRequest } from "@shared/schemas/subscription";

export function mapIAPError(error: unknown): PurchaseError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("user-cancelled") || msg.includes("user cancelled")) {
      return { code: "USER_CANCELLED", message: "Purchase cancelled" };
    }
    // ... other mappings
  }
  return {
    code: "UNKNOWN",
    message: "An unexpected error occurred",
    originalError: error,
  };
}

export function buildReceiptPayload(
  purchase: {
    transactionReceipt: string;
    productId: string;
    transactionId: string;
  },
  platform: "ios" | "android",
): UpgradeRequest {
  return {
    receipt: purchase.transactionReceipt,
    platform,
    productId: purchase.productId,
    transactionId: purchase.transactionId,
  };
}
```

```typescript
// usePurchase.ts — Hook that imports pure functions + React Native
import { useState, useRef, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import {
  mapIAPError,
  buildReceiptPayload,
  isSupportedPlatform,
} from "./purchase-utils";

export function usePurchase() {
  // ... uses pure functions for logic, RN APIs for platform/state
}
```

```typescript
// __tests__/usePurchase.test.ts — Tests pure functions directly
import {
  mapIAPError,
  buildReceiptPayload,
  isSupportedPlatform,
} from "../purchase-utils";

describe("mapIAPError", () => {
  it("maps user-cancelled error", () => {
    expect(mapIAPError(new Error("user-cancelled")).code).toBe(
      "USER_CANCELLED",
    );
  });
});
```

**Extraction checklist — move to `*-utils.ts` if the function:**

- Takes plain data in, returns plain data out (no hooks, no `Platform.OS`, no `Haptics`)
- Does not import from `react-native`, `expo-*`, or any native module
- Can be described without mentioning React (e.g., "maps error codes", "builds payload", "computes label")

**What stays in the hook/component:**

- `useState`, `useRef`, `useCallback`, `useEffect`
- `Platform.OS`, `Haptics.*`, `AsyncStorage`
- Anything that requires a React rendering context

**When to use:** Any time you write logic in a hook or component that you want to unit test and that logic does not inherently depend on React or native APIs.

**When NOT to use:** Logic that is genuinely coupled to React state or native APIs (animation drivers, gesture handlers, navigation actions). For those, use integration tests or manual testing.

**Existing examples:**

- `client/lib/iap/purchase-utils.ts` — `mapIAPError`, `buildReceiptPayload`, `buildRestorePayload`, `isSupportedPlatform`
- `client/components/upgrade-modal-utils.ts` — `BENEFITS`, `getCtaLabel`, `isCtaDisabled`
- `client/lib/serving-size-utils.ts` — serving size calculation logic

### Pure Function Extraction for Server Services

When server-side business logic is complex enough to warrant thorough unit testing, extract it into a pure function in its own service file. The function takes plain data in and returns plain data out, with no database access, no `req`/`res` objects, and no side effects.

```
# File structure
server/services/
  pantry-deduction.ts           # Pure function — no DB, no Express, fully testable
  __tests__/
    pantry-deduction.test.ts    # 9 test cases covering edge cases
```

```typescript
// server/services/pantry-deduction.ts — Pure function, no DB access
import type { PantryItem } from "@shared/schema";
import type { AggregatedGroceryItem } from "./grocery-generation";

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

export function deductPantryFromGrocery(
  groceryItems: AggregatedGroceryItem[],
  pantryItems: PantryItem[],
): AggregatedGroceryItem[] {
  // Build lookup map, subtract quantities, filter out fully covered items
  // No DB calls — caller fetches data and passes it in
}
```

```typescript
// Route handler — fetches data, calls pure function, returns result
app.post("/api/meal-plan/grocery-lists", requireAuth, async (req, res) => {
  const groceryItems = await generateGroceryItems(recipes);
  const pantryItems = features.pantryTracking
    ? await storage.getPantryItems(req.userId!)
    : [];
  const deducted = deductPantryFromGrocery(groceryItems, pantryItems);
  // ... save and return
});
```

**When to use:**

- Complex transformation logic with multiple edge cases (unit conversions, matching, deduction)
- Logic that benefits from 5+ unit tests covering boundary conditions
- Server-side logic that does not need database access

**When NOT to use:**

- Simple CRUD operations where the logic is trivial
- Logic tightly coupled to database queries (keep in storage methods)

**Key difference from the client-side pattern:** The client-side "Pure Function Extraction for Vitest Testability" pattern exists because Vitest cannot import React Native modules. The server-side pattern exists for **design clarity** and **test coverage** — the functions _could_ be tested in-place, but extracting them makes the test file focused and the function's contract explicit.

**Existing examples:**

- `server/services/pantry-deduction.ts` — `deductPantryFromGrocery()` with 9 unit tests
- `client/lib/iap/purchase-utils.ts` — client-side equivalent

### Storage Integration Tests with Transaction Rollback

For testing storage functions against a real database, use the `setupTestTransaction` / `rollbackTestTransaction` utilities to run each test inside a transaction that rolls back after the test — leaving the DB clean.

The key technique: mock the `db` import so all storage functions use the test transaction instead of the real connection pool.

```typescript
// server/storage/__tests__/favourite-recipes.test.ts
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";

// Redirect all storage functions to the test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import AFTER mocking — dynamic import ensures the mock is applied
const { toggleFavouriteRecipe, getFavouriteRecipeCount } = await import(
  "../favourite-recipes"
);

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

beforeEach(async () => {
  tx = await setupTestTransaction();
  testUser = await createTestUser(tx);
});

afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});
```

**When to use:** Storage functions with complex transactional logic (advisory locks, unique constraint races, orphan cleanup, limit enforcement) that can't be adequately tested through route-level mocks.

**When NOT to use:** Simple CRUD storage functions where route-level tests already provide sufficient coverage via mocked storage.

**Gotcha — `fireAndForget` in tests:** Code using `fireAndForget()` executes asynchronously and the caller ignores the return value. Mocking it to return the promise does NOT make it synchronous. Capture the promise in a variable and await it explicitly:

```typescript
let lastFireAndForgetPromise: Promise<unknown> | null = null;
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    lastFireAndForgetPromise = promise;
  },
}));

// In test:
beforeEach(() => {
  lastFireAndForgetPromise = null;
});

it("cleans up orphans", async () => {
  await getResolvedFavouriteRecipes(userId);
  await lastFireAndForgetPromise; // Wait for the background cleanup
  const count = await getFavouriteRecipeCount(userId);
  expect(count).toBe(0);
});
```

**Existing examples:**

- `server/storage/__tests__/favourite-recipes.test.ts` — 24 integration tests
- `test/db-test-utils.ts` — shared transaction setup/teardown utilities

### Dual-Assertion IDOR Test

When writing integration tests for functions that enforce cross-user data ownership, assert **both** the return value and the database state. Return value alone cannot catch a bug where the function returns `null` but still commits a side-effect write — two independent failure modes require two independent checks.

**Write path — assert no new row was written:**

```typescript
it("returns null when conversationId is owned by a different user", async () => {
  const otherUser = await createTestUser(tx);
  const conv = await createChatConversation(
    otherUser.id,
    "Other Chat",
    "recipe",
  );
  const msg = await createChatMessage(
    conv.id,
    otherUser.id,
    "assistant",
    "Recipe!",
    metadata,
  );

  const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);

  // 1. API contract: caller must be told the operation failed
  expect(result).toBeNull();

  // 2. Data integrity: nothing must have been written for the forged ID
  const leaked = await tx
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.sourceMessageId, msg.id));
  expect(leaked).toHaveLength(0);
});
```

**Read-only path — assert the target row was not mutated:**

When the guarded code path is read-only (SELECT only), there is no new row to check. Instead, confirm the target row's ownership fields are unchanged — this rules out an unintended mutation:

```typescript
// Legacy savedRecipeId path — SELECT only, no INSERT
it("returns null when legacy savedRecipeId references another user's recipe (IDOR)", async () => {
  // ...setup: otherUser owns otherRecipe, testUser forges the savedRecipeId...
  const result = await saveRecipeFromChat(msg.id, conv.id, testUser.id);
  expect(result).toBeNull();

  // Confirm read-only path left the target row untouched
  const [afterAttempt] = await tx
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, otherRecipe.id));
  expect(afterAttempt).toBeDefined();
  expect(afterAttempt!.authorId).toBe(otherUser.id);
});
```

**`onConflictDoNothing` idempotency tests — name the conflict key:**

When pre-inserting a row to trigger `onConflictDoNothing`, add a comment naming the unique constraint that fires. Without it, a reader must trace through the implementation to know whether the conflict key is `sourceMessageId`, `normalizedProductName`, or something else — and if the wrong field was pre-populated, the conflict never triggers and the test silently covers the wrong branch.

```typescript
// The unique constraint that fires is on sourceMessageId (confirmed by
// the fallback SELECT in recipe-from-chat.ts:118). normalizedProductName
// is recipe.title.toLowerCase() = "test-chicken salad" — matches here.
const [preInserted] = await tx
  .insert(communityRecipes)
  .values({
    normalizedProductName: "test-chicken salad",
    sourceMessageId: msg.id, // ← conflict key
    // ...
  })
  .returning();
```

**When to use:**

- Any integration test for a storage function that guards cross-user access
- Tests for the [IDOR Protection in Storage Layer](security.md#idor-protection-in-storage-layer) pattern — these tests are its verification counterpart

**When NOT to use:**

- Route-level tests with mocked storage — the mock already prevents DB writes, so a DB state assertion would be vacuously true
- Non-security behaviors where the return value fully characterizes the outcome

**References:**

- `server/storage/__tests__/chat.test.ts` — `saveRecipeFromChat` IDOR tests (H9): write-path and read-path variants
- `server/storage/__tests__/coach-notebook.test.ts` — `getNotebookEntryById` IDOR test (M5)

---

### Pure Functions Outside React Component Bodies

When a function inside a React component does not depend on props, state, or hooks, define it **outside** the component body at module scope. This avoids recreating the function on every render and eliminates the need for `useCallback` or `useMemo`.

```typescript
// Good: Pure function at module scope — created once, never recreated
function getConfidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

function formatDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return `${value}`;
}

export default function CookSessionReviewScreen() {
  // Uses getConfidenceLabel() and formatDelta() — no useCallback needed
}
```

```typescript
// Bad: Pure function inside component — recreated on every render
export default function CookSessionReviewScreen() {
  function getConfidenceLabel(confidence: number): string {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.5) return "Medium";
    return "Low";
  }
  // ...
}
```

**Rule of thumb:** If the function doesn't reference `props`, `state`, `ref`, `theme`, or any hook result, it belongs outside the component.

**Key difference from the "Pure Function Extraction for Vitest Testability" pattern:** That pattern extracts functions to _separate files_ (`*-utils.ts`) to make them testable in Vitest without React Native imports. This pattern simply moves functions _above_ the component in the same file for performance — no new file needed.

**References:**

- `client/screens/CookSessionReviewScreen.tsx` — `getConfidenceLabel()`
- `client/screens/SubstitutionResultScreen.tsx` — `formatDelta()`

### Type Guard Over `as` Cast for Runtime Safety

Never use `as TypeName` to assert a value's type when the value comes from external input (database, API, user input). Always use a type guard function that performs a runtime check.

```typescript
// Bad: Unsafe cast — silently accepts invalid values
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier as SubscriptionTier];
// If tier is "invalid_value", this indexes into TIER_FEATURES with a bad key
// and returns undefined — causing runtime errors downstream

// Good: Type guard with fallback
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

const tier = subscription?.tier || "free";
const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
// Invalid tiers safely fall back to "free" — no runtime surprises
```

**When to use:**

- Any value from the database, API response, or user input that needs to be narrowed to a union type
- Enum-like `text()` columns in Drizzle (which return `string`, not the union type)
- Route parameters, query strings, or `req.body` fields

**When NOT to use:**

- Values already validated by Zod schemas (Zod narrows the type correctly)
- Compile-time-only type narrowing where the value is known at build time

**Key insight:** `as SubscriptionTier` tells TypeScript "trust me, this is valid" but performs zero runtime checking. If the database contains a value not in the union (e.g., from a migration), the cast silently produces a value that TypeScript considers valid but JavaScript cannot use correctly.

**References:**

- `shared/types/premium.ts` — `isValidSubscriptionTier()` type guard, `subscriptionTiers` tuple, and `SubscriptionTier` type (type guard is colocated with the source array it validates)
- Related learning: "Unsafe `as` Casts Hide Runtime Bugs" in LEARNINGS.md

### vi.resetModules for Env-Dependent Module Testing

When a module evaluates environment variables at the top level (e.g., `const STUB_MODE = !process.env.X`), Vitest caches the module after the first import. Changing `process.env` in a later test has no effect because the cached module still has the old values baked into its constants. Use `vi.resetModules()` + dynamic `await import()` to get a fresh module evaluation with the current `process.env`.

```typescript
describe("stub mode (no credentials)", () => {
  beforeEach(() => {
    delete process.env.APPLE_ISSUER_ID;
    delete process.env.APPLE_KEY_ID;
    delete process.env.APPLE_PRIVATE_KEY;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv }; // Restore original env
  });

  it("auto-approves in development when RECEIPT_VALIDATION_STUB=true", async () => {
    process.env.NODE_ENV = "development";
    process.env.RECEIPT_VALIDATION_STUB = "true";

    vi.resetModules(); // Clear Vitest's module cache
    const { validateReceipt } = await import("../receipt-validation"); // Fresh import

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(true);
  });

  it("does NOT auto-approve when RECEIPT_VALIDATION_STUB is not set", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.RECEIPT_VALIDATION_STUB;

    vi.resetModules();
    const { validateReceipt } = await import("../receipt-validation");

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(false);
    expect(result.errorCode).toBe("PLATFORM_NOT_CONFIGURED");
  });
});
```

For tests with repetitive setup (multiple env vars + fetch mocking), extract a setup helper:

```typescript
/**
 * Setup helper for Google validation tests. Re-imports module with fresh
 * env, resets caches, and mocks fetch with the given subscription response.
 */
async function setupGoogleTest(subscriptionResponse: object, status = 200) {
  vi.resetModules();
  const mod = await import("../receipt-validation");
  mod.resetGoogleTokenCache();

  const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (urlStr.includes("oauth2.googleapis.com")) {
      return new Response(
        JSON.stringify({ access_token: "mock", expires_in: 3600 }),
        { status: 200 },
      );
    }
    if (urlStr.includes("androidpublisher.googleapis.com")) {
      return new Response(JSON.stringify(subscriptionResponse), { status });
    }
    throw new Error(`Unexpected fetch to ${urlStr}`);
  });

  return { validate: mod.validateReceipt, fetchSpy };
}

// Usage — each test gets a fresh module with correct env
it("validates active subscription", async () => {
  const { validate, fetchSpy } = await setupGoogleTest({
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    lineItems: [{ productId: "premium_monthly", expiryTime: futureDate }],
  });
  const result = await validate("token", "android");
  expect(result.valid).toBe(true);
  fetchSpy.mockRestore();
});
```

**When to use:**

- Testing modules that read `process.env` at the top level (module-scope `const` evaluated at import time)
- Testing different configurations of the same service (stub mode vs. real mode, different platform credentials)
- Any module with `const X = !!process.env.Y` or `const X = process.env.Y ?? "default"` at module scope

**When NOT to use:**

- Modules that read env vars lazily inside functions (just set `process.env.X` before calling the function)
- Tests where a single env configuration is sufficient for the entire describe block

**Key pitfall:** After `vi.resetModules()`, you must re-import the module with `await import()`. Any references to the old module's exports are stale. If the module also has internal caches (like token caches), export a `resetCache()` function and call it after re-import.

**References:**

- `server/services/__tests__/receipt-validation.test.ts` — `setupGoogleTest()` helper and stub mode tests
- Related learning: "Module-Level Service Client Initialization Breaks Test Imports" in LEARNINGS.md

### Testing Real express-rate-limit Behavior (Bypass the Global Passthrough Mock)

`__mocks__/express-rate-limit.ts` at the project root replaces the real limiter with a passthrough whenever any test calls `vi.mock("express-rate-limit")`. Most route tests want that — they assert quota-based 429s by faking the storage counter, not by exercising the middleware. But when the endpoint's rate limit is the ONLY 429 trigger (e.g., a data-export endpoint where the AC requires `429 when rate limit exceeded`), the passthrough mock makes the test impossible.

The fix: scope the unmock to a single test, then dynamically re-import the route module so it binds to the real `rateLimit` factory.

```typescript
it("returns 429 after the configured rate limit is exceeded", async () => {
  // Use the real express-rate-limit so the limiter actually counts requests.
  vi.doUnmock("express-rate-limit");

  // Re-mock storage on the fresh module graph — the previous mock is dropped
  // along with the cached express-rate-limit when resetModules runs implicitly.
  vi.doMock("../../storage", () => ({
    storage: { getUserDataExport: vi.fn().mockResolvedValue(buildExport()) },
  }));

  const { register: registerReal } = await import("../export");
  const app = express();
  app.use(express.json());
  registerReal(app);

  // The route is configured at 2 requests/hour. The first two succeed; the
  // third returns 429 from the real express-rate-limit middleware.
  const a = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");
  const b = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");
  const c = await request(app)
    .get("/api/users/me/export")
    .set("Authorization", "Bearer t");

  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(c.status).toBe(429);
});
```

**Why dynamic import:** `vi.doUnmock` only affects modules imported AFTER the call. The route module was already imported at the top of the file (with the passthrough mock active), so its `exportRateLimit` is bound to the passthrough. The dynamic `await import("../export")` after `doUnmock` triggers a fresh evaluation that picks up the real factory.

**Why `vi.doMock` for storage:** dropping the passthrough also drops the existing storage mock from the route's module graph — you must restate it on the fresh graph.

**Caveat:** the limiter's in-memory store persists for the lifetime of the test process. If a second test in the same file needs the real limiter again, the counter may already be exhausted. Keep "real limiter" tests in their own describe block at the bottom of the file, or instantiate a fresh app with a separately-imported limiter inside each test.

**References:** `server/routes/__tests__/export.test.ts`

### Mocking Class Constructors in vi.mock

When mocking a module that exports a class instantiated with `new` (e.g., `new SignedDataVerifier(...)`), use a real `class` in the mock factory — not `vi.fn().mockImplementation(() => ...)`. Arrow functions cannot be called with `new`, causing `TypeError: ... is not a constructor`.

```typescript
// ✅ GOOD: Class mock — works with `new`
const mockMethod = vi.fn();

vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<
    typeof import("@apple/app-store-server-library")
  >("@apple/app-store-server-library");
  return {
    ...actual,
    SignedDataVerifier: class MockSignedDataVerifier {
      verifyAndDecodeTransaction = mockMethod;
    },
  };
});
```

```typescript
// ❌ BAD: Arrow function — throws "is not a constructor"
vi.mock("@apple/app-store-server-library", async () => {
  const actual = await vi.importActual<...>("@apple/app-store-server-library");
  return {
    ...actual,
    SignedDataVerifier: vi.fn().mockImplementation(() => ({
      verifyAndDecodeTransaction: mockMethod,
    })),
  };
});
```

**Key elements:**

1. **Declare `mockMethod` outside** the `vi.mock()` factory so tests can configure it per test case
2. **Use `importActual`** and spread the real module to preserve non-mocked exports (enums, types, error classes)
3. **Assign mock methods as instance properties** (`= mockMethod`) inside the class body
4. **Reset the mock** in `beforeEach` with `mockMethod.mockReset()` to prevent state leakage
5. **Reset singletons** — if the production code caches the instance (lazy singleton), export a `resetX()` function and call it after `vi.resetModules()`

**When to use:**

- Mocking SDK clients instantiated with `new` (Apple `SignedDataVerifier`, AWS `S3Client`, Stripe `Stripe`, etc.)
- Any `vi.mock` where the mocked export is called as a constructor

**When NOT to use:**

- Mocking plain functions or objects (use `vi.fn()` directly)
- Mocking modules where you don't need `new` (use `vi.fn().mockReturnValue()`)

**References:**

- `server/services/__tests__/receipt-validation.test.ts` — `MockSignedDataVerifier` class mock with `mockVerifyAndDecodeTransaction`

### Exhaustive-Partition Lock via Shared-Type Enum

When a function **intentionally** handles only a subset of a shared union type's values, the gap can silently widen as new values are added to the type. Lock the intentional partition with a test that fails if a newly-added enum value is not categorized — forcing the author to make an explicit "covered" vs "not inferred" decision.

The source file documents the split in a JSDoc comment, and the test enumerates both sides against the shared type:

```typescript
// client/lib/recipe-tag-inference.ts — document the partition
/**
 * Infer diet tags from an ingredient list.
 *
 * Coverage of `DIET_TAG_OPTIONS`:
 *
 *   Covered by ingredient heuristics:
 *     - Vegetarian, Vegan, Gluten Free, Dairy Free
 *
 *   Intentionally NOT inferred (require per-serving macronutrient data):
 *     - Keto, Paleo, Low Carb, High Protein
 *
 * We prefer to surface no suggestion over a wrong one.
 */
export function inferDietTags(ingredientNames: string[]): DietTag[] {
  /* ... */
}
```

```typescript
// client/lib/__tests__/recipe-tag-inference.test.ts — lock the partition
describe("inferDietTags — DIET_TAG_OPTIONS coverage", () => {
  const COVERED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Vegetarian",
    "Vegan",
    "Gluten Free",
    "Dairy Free",
  ];

  // Intentionally NOT inferred — require macronutrient data.
  const NOT_INFERRED: readonly (typeof DIET_TAG_OPTIONS)[number][] = [
    "Keto",
    "Paleo",
    "Low Carb",
    "High Protein",
  ];

  it("DIET_TAG_OPTIONS is exhaustively partitioned", () => {
    const partitioned = new Set([...COVERED, ...NOT_INFERRED]);
    expect(partitioned.size).toBe(DIET_TAG_OPTIONS.length);
    for (const tag of DIET_TAG_OPTIONS) {
      expect(partitioned.has(tag)).toBe(true);
    }
  });

  // Per-tag assertions follow — one positive test per COVERED tag, one
  // "never emitted" parameterized test for the NOT_INFERRED side.
  for (const tag of NOT_INFERRED) {
    it(`never emits "${tag}" from any sample ingredient list`, () => {
      const samples: string[][] = [
        ["chicken", "avocado", "olive oil"],
        ["beef", "lettuce", "cheese"],
        ["rice", "beans", "tomato"],
      ];
      for (const sample of samples) {
        expect(inferDietTags(sample)).not.toContain(tag);
      }
    });
  }
});
```

**Why both sides?** Listing only `COVERED` would let a new enum value silently fall into the "not inferred" bucket without review. Listing both, unioned against the shared type, fails the test if anyone adds a value without categorizing it.

**Checklist:**

1. Does the function branch on **some but not all** values of a shared type?
2. Is there a documented reason the excluded values are excluded?
3. Would a new enum value silently fall into the wrong bucket if nobody updated the logic?

If all three, add an exhaustive-partition test.

**When to use:** Any intentional enum-subset behavior where the shared type lives elsewhere and future developers may add values without finding this site. Candidates in this codebase: subscription tiers that gate specific features, meal types with different AI prompts, API rate-limit tiers, onboarding screen orderings.

**When NOT to use:** Functions that genuinely handle every value of the type (use TypeScript's `assertNever` exhaustive-switch pattern instead — the compiler enforces it, no test needed).

**Related:** The `assertNever` / `never` exhaustive-switch pattern covers the "I must handle every case" scenario. This pattern covers the complementary "I intentionally handle only some cases" scenario.

**References:**

- `client/lib/recipe-tag-inference.ts:228-248` — partition documented in JSDoc on `inferDietTags`
- `client/lib/__tests__/recipe-tag-inference.test.ts:87-173` — `DIET_TAG_OPTIONS coverage` suite
- Origin: recipe-wizard code-review L2 (commits `fe87638`, `beb18d0`)

## Automated Enforcement

### Pre-Commit Hook

The pre-commit hook (`.husky/pre-commit`) runs three stages in sequence:

1. **TypeScript type checking** — `tsc --noEmit --project tsconfig.check.json` (production code only, excludes test files)
2. **Full test suite** — `npm run test:run` (~2300+ Vitest tests)
3. **Lint-staged** — applies the following checks to staged files:

| Glob              | Checks                                                |
| ----------------- | ----------------------------------------------------- |
| `*.{ts,tsx}`      | `eslint --fix`, `prettier --write`                    |
| `client/**/*.tsx` | `check-accessibility.js`, `check-hardcoded-colors.js` |
| `*.{js,md}`       | `prettier --write`                                    |

### ESLint Ban on `as never` in Tests

The `no-restricted-syntax` rule in `eslint.config.js` blocks `as never` casts in all `*.test.{ts,tsx}` files:

```javascript
{
  files: ["**/*.test.{ts,tsx}"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "TSAsExpression > TSNeverKeyword",
        message: "Do not use 'as never' in tests. Use typed mock factories from server/__tests__/factories instead.",
      },
    ],
  },
},
```

This technique — using `TSAsExpression > TSNeverKeyword` AST selector — can be reused to ban other unsafe casts. The selector targets any `x as never` expression in the code.

### Custom ESLint Rules (`eslint-plugin-ocrecipes`)

Three custom rules in `eslint-plugin-ocrecipes/index.js` enforce server-side patterns. They apply to `server/routes/**/*.ts` via `eslint.config.js`:

| Rule                               | Enforces                                | Error Flagged                                       |
| ---------------------------------- | --------------------------------------- | --------------------------------------------------- |
| `ocrecipes/no-bare-error-response` | `sendError()` pattern                   | `res.status(4xx/5xx).json({ error: ... })`          |
| `ocrecipes/no-parseint-req`        | `parsePositiveIntParam`/`parseQueryInt` | `parseInt(req.params.*)` or `parseInt(req.query.*)` |
| `ocrecipes/no-as-string-req`       | `parseQueryString`/`parseStringParam`   | `req.params.* as string` or `req.query.* as string` |

### Custom Lint Scripts

| Script                              | Scope             | Checks                                                                                                                                                                                                                          |
| ----------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-accessibility.js`    | `client/**/*.tsx` | `Pressable`/`TouchableOpacity` with `onPress` missing `accessibilityLabel`; `TextInput` without `accessibilityLabel`                                                                                                            |
| `scripts/check-hardcoded-colors.js` | `client/**/*.tsx` | All hex colors (`#RGB`, `#RRGGBB`, etc.) and named CSS colors (`"white"`, `"black"`, etc.). Opt out with `// hardcoded` inline comment (see [Prettier-Safe Lint Suppressions in JSX](#prettier-safe-lint-suppressions-in-jsx)). |

### Prettier-Safe Lint Suppressions in JSX

When a lint check requires a comment on the **same line** as flagged code (e.g., `// hardcoded` for the color checker), use a trailing `//` comment on the JSX prop — not a `{/* */}` JSX comment:

```tsx
// Good: // comment on the prop line — Prettier keeps it in place
<Ionicons
  name="checkmark-circle"
  size={16}
  color="#2E7D32" // hardcoded — semantic green for met-goal
/>

// Bad: {/* */} comment — Prettier moves it to the next line
<Ionicons name="checkmark-circle" size={16} color="#2E7D32" />{" "}
{/* hardcoded — Prettier puts this on line N+1, checker looks at line N */}
```

**When to use:**

- Any lint suppression that must be on the same line as the flagged value
- `// hardcoded` opt-outs for the color checker
- `// eslint-disable-next-line` equivalents in JSX props

**Why:** Prettier treats `{/* */}` as a JSX child element and freely reflows it onto separate lines. Trailing `//` comments on prop lines are preserved because Prettier won't split a prop from its trailing comment.

### Multi-Photo GPT-4o Vision Calls

When analyzing multi-page documents (receipts, menus), send all photos as separate `image_url` entries in a single API call rather than making multiple calls:

```typescript
// server/services/receipt-analysis.ts
const imageContent = imagesBase64.map((base64) => ({
  type: "image_url" as const,
  image_url: {
    url: `data:image/jpeg;base64,${base64}`,
    detail: "high" as const,
  },
}));

const response = await openai.chat.completions.create({
  model: "gpt-4o",
  max_completion_tokens: 4096,
  temperature: 0.2, // Low temperature for structured extraction
  messages: [
    { role: "system", content: RECEIPT_PROMPT },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract all food items from this receipt:" },
        ...imageContent,
      ],
    },
  ],
  response_format: { type: "json_object" },
});
```

**When to use:** Analyzing multi-page/multi-photo documents where context spans images (receipts, multi-page menus).

**When NOT to use:** Independent single-photo analyses where results don't depend on each other.

**Why:** A single call gives the model cross-image context (e.g., store name on page 1, items on page 2), is faster than sequential calls, and uses fewer API requests.

### Monthly Usage Cap with COUNT(\*)

For premium features with monthly limits, use `COUNT(*)` instead of fetching all rows:

```typescript
// server/storage/receipt.ts
import { sql } from "drizzle-orm";

export async function getMonthlyReceiptScanCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfMonth, endOfMonth } = getMonthBounds(date);
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(receiptScans)
    .where(
      and(
        eq(receiptScans.userId, userId),
        ne(receiptScans.status, "failed"), // Failed attempts don't count
        gte(receiptScans.scannedAt, startOfMonth),
        lte(receiptScans.scannedAt, endOfMonth),
      ),
    );
  return Number(result[0]?.count ?? 0);
}
```

Route usage:

```typescript
const count = await getMonthlyReceiptScanCount(req.userId!, new Date());
if (count >= features.monthlyReceiptScans) {
  return sendError(
    res,
    429,
    "Monthly receipt scan limit reached",
    ErrorCode.LIMIT_REACHED,
  );
}
```

**When to use:** Any usage-capped feature (monthly scans, daily limits).

**When NOT to use:** When you need the actual rows for further processing — then query and count.

**Why:** `COUNT(*)` is handled entirely by the database without transferring row data. Fetching all rows via `select().from()` + `.length` transfers unnecessary data and scales poorly.

### Import + Re-export for Shared Types

When a module both uses a shared type internally and re-exports it for consumers, you must import it separately — `export type` alone doesn't bring the type into scope:

```typescript
// server/services/photo-analysis.ts

// Import for use in this file
import type { LabelExtractionResult } from "@shared/types/label-analysis";
// Re-export for consumers that import from this module
export type { LabelExtractionResult } from "@shared/types/label-analysis";

export async function analyzeLabelPhoto(
  imageBase64: string,
): Promise<LabelExtractionResult> {
  // ← needs the import above
  // ...
}
```

**When to use:** Any file that both uses and re-exports a type from `shared/types/`.

**When NOT to use:** If the file only re-exports (barrel file) or only uses the type internally.

**Why:** TypeScript's `export type { X } from "..."` is a pass-through — it doesn't create a local binding. Without the separate `import type`, the type is `undefined` within the file.

### `popToTop()` for Multi-Modal Dismiss

When a flow spans multiple stacked modals (e.g., Camera → Review → Confirm), use `navigation.popToTop()` on the terminal action to dismiss the entire modal stack:

```typescript
// client/screens/ReceiptReviewScreen.tsx
confirmMutation.mutate(confirmItems, {
  onSuccess: () => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    // Pop both ReceiptReview and ReceiptCapture modals
    navigation.popToTop();
  },
});
```

**When to use:** After completing a multi-step modal flow (capture → review → confirm) where the user should return to the main app.

**When NOT to use:** Single-modal flows where `goBack()` returns to the right screen.

**Why:** `goBack()` only pops one screen — in a Camera → Review stack, it returns to the camera instead of the main app. `popToTop()` dismisses the entire modal stack cleanly.

### React Native FormData File Upload Cast

React Native's `FormData.append()` for file uploads requires an object with `uri`/`type`/`name` fields, but TypeScript types it as `Blob`. Use `as unknown as Blob` with a comment:

```typescript
// React Native FormData accepts object with uri/type/name (differs from web Blob API)
formData.append("photos", {
  uri: compressed.uri,
  type: "image/jpeg",
  name: `receipt_${index}.jpg`,
} as unknown as Blob);
```

**When to use:** Any `FormData` file upload in React Native.

**Why:** React Native's network layer serializes `{ uri, type, name }` objects as multipart file parts, but TypeScript expects `Blob | string`. The cast is unavoidable — the comment explains why.

### Typed Mock Factories for Test Data

Use typed factory functions from `server/__tests__/factories/` to create mock data in tests. Each factory returns a complete schema-compliant object and accepts `Partial<T>` overrides. This replaces unsafe `as never` casts, which are now banned by ESLint.

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

**Available factories:** `server/__tests__/factories/index.ts` re-exports all factories organized by domain:

| File              | Factories                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.ts`         | `createMockUser`, `createMockUserProfile`                                                                                                                                                                                       |
| `nutrition.ts`    | `createMockScannedItem`, `createMockDailyLog`, `createMockNutritionData`, `createMockCookedNutrition`, `createMockChatCompletion`, `createMockNutritionCache`, `createMockMicronutrientCache`, `createMockFavouriteScannedItem` |
| `recipes.ts`      | `createMockMealPlanRecipe`, `createMockRecipeIngredient`, `createMockMealPlanItem`, `createMockCommunityRecipe`, `createMockRecipeGenerationLog`, `createMockCookbook`, `createMockCookbookRecipe`                              |
| `grocery.ts`      | `createMockGroceryList`, `createMockGroceryListItem`, `createMockPantryItem`                                                                                                                                                    |
| `chat.ts`         | `createMockChatConversation`, `createMockChatMessage`                                                                                                                                                                           |
| `health.ts`       | `createMockWeightLog`, `createMockHealthKitSync`, `createMockFastingSchedule`, `createMockFastingLog`, `createMockMedicationLog`, `createMockGoalAdjustmentLog`                                                                 |
| `subscription.ts` | `createMockTransaction`                                                                                                                                                                                                         |
| `scan.ts`         | `createMockMenuScan`, `createMockReceiptScan`                                                                                                                                                                                   |
| `verification.ts` | `createMockBarcodeVerification`, `createMockVerificationHistory`, `createMockReformulationFlag`, `createMockApiKey`, `createMockApiKeyUsage`, `createMockBarcodeNutrition`                                                      |
| `cache.ts`        | `createMockSuggestionCache`, `createMockInstructionCache`, `createMockMealSuggestionCache`                                                                                                                                      |
| `saved-item.ts`   | `createMockSavedItem`                                                                                                                                                                                                           |

**When to use:** Any test that mocks a storage function or service returning a domain object.

**When NOT to use:** Mocking simple primitives (`true`, `0`, `[]`) or `undefined` — these don't need a factory.

**Why this matters:** When a schema column is added, renamed, or removed, the factory's defaults produce a compile error — the single place to fix. Without factories, 583+ mock sites silently pass with incomplete objects, and type mismatches only surface in production.

**Adding a new factory:** When a new table is added to `shared/schema.ts`, add a factory to the appropriate domain file (or create a new file) and re-export from `index.ts`. Fill in all required fields with sensible defaults.

**Format-flexible columns: align defaults with a real production insert site.** When a schema column has no DB-level format constraint (bare `text`, `jsonb`, etc.) and is consumed by parsing logic, the factory default must match a string produced by a real production writer — not a plausible-looking guess. Grep for the writer (`String(recipeId)` in `server/storage/carousel.ts`, etc.) and copy the shape. A mismatched default produces rows that read-side parsers silently drop (e.g. `parseInt("community:1", 10)` → `NaN`), so tests pass while exercising none of the real parsing path. If multiple writers produce different shapes, comment which one the default matches and instruct callers to override per scenario.

### Storage Return Types: `undefined` for "Not Found"

Storage functions that look up a single record return `T | undefined` (not `T | null`) when the record doesn't exist. This is enforced by Drizzle's `result[0]` pattern which yields `undefined` for empty results.

```typescript
// Storage implementation
export async function getUser(id: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user; // undefined if not found
}

// ✅ Test mock: undefined for "not found"
vi.mocked(storage.getUser).mockResolvedValue(undefined);

// ❌ Wrong: null — doesn't match the return type
vi.mocked(storage.getUser).mockResolvedValue(null);
```

**Exceptions:** Some storage functions explicitly return `null` for business-logic reasons (e.g., `createGroceryListWithLimitCheck` returns `null` when the limit is exceeded, `getApiKey` returns `T | null`). Check the storage function's return type before choosing `undefined` vs `null` in your mock.

### Facade Mock Alignment for Re-Exported Values

When `vi.mock("../../storage")` intercepts the storage facade, the mock replaces the **entire module** — including any re-exported values like types, classes, and constants. If a route imports a re-exported value (e.g., `import { storage, MAX_IMAGE_SIZE_BYTES } from "../storage"`), the mock must include it or the route receives `undefined` and throws at runtime.

```typescript
// ❌ BAD: Mock only returns `storage` — re-exported constants are undefined
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    createScannedItem: vi.fn(),
  },
}));
// Route does: import { storage, MAX_IMAGE_SIZE_BYTES } from "../storage"
// MAX_IMAGE_SIZE_BYTES is undefined → route throws → test gets 500

// ✅ GOOD: Mock includes re-exported values from sub-modules
vi.mock("../../storage", async () => {
  const sessions = await import("../../storage/sessions");
  return {
    MAX_IMAGE_SIZE_BYTES: sessions.MAX_IMAGE_SIZE_BYTES,
    storage: {
      getUser: vi.fn(),
      createScannedItem: vi.fn(),
    },
  };
});
```

For re-exported classes used in `instanceof` checks (like `BatchStorageError`), the mock must return the real class — otherwise `catch` blocks that check `error instanceof BatchStorageError` won't match:

```typescript
vi.mock("../../storage", async () => {
  const batch = await import("../../storage/batch");
  return {
    BatchStorageError: batch.BatchStorageError,
    storage: {
      /* ... */
    },
  };
});
```

**When to update mocks:**

- When adding a new re-export to `server/storage/index.ts`
- When changing a route from a direct sub-module import to a facade import
- When a test gets unexpected 500s after a refactor that didn't change business logic

**Symptoms of misalignment:**

- Tests expect 200/400/404 but get 500
- Error messages like `Cannot read properties of undefined` in test output
- Tests pass in isolation but fail when run with the full suite (mock hoisting order)

**References:**

- `server/routes/__tests__/photos.test.ts` — `MAX_IMAGE_SIZE_BYTES` re-exported from sessions
- `server/routes/__tests__/batch-scan.test.ts` — `BatchStorageError` re-exported from batch
- `server/routes/__tests__/cooking.test.ts` — `cookingSessionStore` re-exported with real implementation

### Always Provide a Factory for Modules with Side Effects

`vi.mock("module")` without a factory still loads the real module to discover its exports and auto-mock them. If the module has eager side effects (e.g., `db.ts` throws when `DATABASE_URL` is missing), the auto-mock will fail.

```typescript
// ❌ BAD — auto-mock loads the module, DATABASE_URL check fires
vi.mock("../../storage");

// ✅ GOOD — factory prevents the real module from loading
vi.mock("../../storage", () => ({ storage: {} }));

// ✅ GOOD — factory with meaningful stubs
vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    createItem: vi.fn(),
  },
}));
```

**When to use:** Mocking any module that imports `../db`, `../lib/openai`, or any other module with top-level side effects.

**Gotcha:** Variables defined outside the factory aren't available inside it because `vi.mock` is hoisted to the top of the file. Define classes/values inside the factory:

```typescript
// ❌ BAD — class isn't initialized when hoisted factory runs
class MockError extends Error { ... }
vi.mock("../../storage", () => ({ MyError: MockError }));

// ✅ GOOD — define inside the factory
vi.mock("../../storage", () => {
  class MockError extends Error { ... }
  return { MyError: MockError };
});
```

**References:**

- `server/routes/__tests__/batch-scan.test.ts` — `BatchStorageError` defined inside factory
- `server/routes/__tests__/_helpers.test.ts` — storage mock with factory to avoid db.ts

**Origin:** Coach Pro test failures (2026-04-10) — 4 test files failed because auto-mock triggered `DATABASE_URL` check

**Gotcha 2 — `vi.hoisted()` for mock handle variables:**

When a test needs a handle on a mock function defined alongside a `vi.mock()` factory, the standard `const mockFn = vi.fn()` pattern breaks if the mocked module is imported statically:

```typescript
// ❌ BREAKS when the production module uses a static import of "../../storage"
const mockUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock("../../storage/index", () => ({
  storage: { updateCommunityRecipeImageUrl: mockUpdate }, // ReferenceError!
}));

// ✅ CORRECT — vi.hoisted() runs before the mock factory
const mockUpdate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../storage/index", () => ({
  storage: { updateCommunityRecipeImageUrl: mockUpdate },
}));
```

This problem surfaces specifically when converting a `dynamic import()` call to a
static `import` — the dynamic form deferred evaluation until runtime (after mocks
were set up), while the static form evaluates at module load time before the
`const mockUpdate` line runs.

**Rule of thumb:** If you see `ReferenceError: Cannot access 'mockX' before initialization` in a test that uses `vi.mock()`, the mock variable needs `vi.hoisted()`.

**Reference:** `server/services/__tests__/recipe-generation.test.ts` — `mockUpdateCommunityRecipeImageUrl` uses `vi.hoisted()` after `recipe-generation.ts` was changed from dynamic `await import("../storage/index")` to a static import.

**Origin:** 2026-04-28 audit L12 — converting dynamic import to static broke the test.

### Feature Flag Routing Divergence in Tests

When premium tier checks create routing forks in handlers, tests must mock the function matching the code path their mocked tier triggers. Mocking `tier: "premium"` but only stubbing the free-tier function is a common source of 503/500 errors in tests.

```typescript
// Route handler branches on premium tier:
const isCoachPro = !!features.coachPro;
if (isCoachPro) {
  for await (const chunk of generateCoachProResponse(...)) { ... }
} else {
  for await (const chunk of generateCoachResponse(...)) { ... }
}
```

```typescript
// ❌ BAD — test mocks premium tier but only stubs the free-tier function
vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({ tier: "premium" });
vi.mocked(generateCoachResponse).mockReturnValue(fakeStream()); // never called!

// ✅ GOOD — mock the function matching the premium code path
vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({ tier: "premium" });
vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream());
```

**When to use:** Any test that mocks subscription tier and exercises a route with tier-dependent branching (coach, recipe generation, meal suggestions).

**References:**

- `server/routes/__tests__/chat.test.ts` — streaming tests use `generateCoachProResponse` for premium tier
- `shared/types/premium.ts` — `TIER_FEATURES` maps tiers to feature booleans

**Origin:** Coach Pro test failures (2026-04-10) — 7 chat tests returned 503 because premium tier routed to `generateCoachProResponse` but only `generateCoachResponse` was mocked

### LLM Evaluation as a Separate Testing Tier

Unit tests (Vitest) verify code correctness. **Evals** verify _output quality_ of AI features. They are fundamentally different and live separately:

|                 | Unit Tests              | Evals                                   |
| --------------- | ----------------------- | --------------------------------------- |
| **Location**    | `__tests__/` co-located | `evals/` at project root                |
| **Runner**      | `npm run test:run`      | `npm run eval:coach`                    |
| **Speed**       | Milliseconds            | Minutes (API calls)                     |
| **Cost**        | Free                    | ~$0.30/run (OpenAI + Anthropic)         |
| **Pre-commit**  | Yes (blocks commit)     | No (manual runs only)                   |
| **Determinism** | Deterministic           | Non-deterministic (±0.5 score variance) |

**Eval architecture — hybrid approach:**

1. **Hard assertions** (pass/fail) for safety-critical checks — regex-based `mustContain`/`mustNotContain` and LLM-judged calorie floor checks. A single failure = test case failure.
2. **LLM-as-Judge rubric scoring** (1-10) for quality dimensions — a stronger model (Claude Sonnet 4.6) evaluates the weaker model's (gpt-4o-mini) responses against structured anchors.

```typescript
// evals/datasets/coach-cases.json — test case structure
{
  "id": "personalization-keto-nut-allergy-01",
  "category": "personalization",
  "userMessage": "What are some good snack ideas for me?",
  "context": { /* CoachContext with keto diet + nut allergies */ },
  "assertions": {
    "mustNotContain": ["almond", "cashew", "walnut", "peanut"]
  }
}
```

**When to use:** Any AI feature where output quality matters (coach, photo analysis, recipe chat). Run evals before and after prompt changes to measure impact.

**When NOT to use:** Non-AI features. Don't replace unit tests with evals — they test different things.

**Key lesson:** Run-to-run variance of ±0.5 points is normal. Look at trends across 3+ runs, not individual scores.

**Multi-suite extension — `SuiteConfig` pattern:**

When extending the eval framework to cover additional AI services, don't duplicate the runner. Add a new `runner-<service>.ts` entrypoint that passes a `SuiteConfig` to `runEvalSuite()` from `evals/lib/runner-core.ts`. The config specifies the rubric text, dimension list, weights, and two callbacks:

```typescript
runEvalSuite(testCases, {
  suiteName: "recipe-generation",
  rubricText: RUBRIC_TEXT,
  dimensions: ["ingredient_coherence", "instruction_clarity", "dietary_compliance", "creativity"],
  dimensionWeights: { dietary_compliance: 2, /* others: 1 */ },
  inputTag: "recipe_request",
  outputTag: "generated_recipe",

  generateResponse: async (testCase) => {
    const i = testCase.input as RecipeGenInput;
    const recipe = await generateRecipeContent({ productName: i.productName, ... });
    return {
      text: serialiseRecipe(recipe),
      structuredData: { ingredients: recipe.ingredients, instructions: recipe.instructions },
      latencyMs: ...,
      wordCount: ...,
    };
  },

  formatInput: (testCase) => {
    const i = testCase.input as RecipeGenInput;
    return `Recipe request: ${i.productName}`;
  },
});
```

The `generateResponse` callback receives the full `EvalTestCase` (not just `testCase.input`) so coach cases (top-level `userMessage`/`context`) and non-coach cases (nested `input`) can coexist in the same runner infrastructure.

**`structuredData` shape contract (critical gotcha):**

`runStructuralAssertions(structuredData, assertions)` and the `generateResponse` callback share an implicit data contract — they must agree on the `structuredData` shape. TypeScript types `structuredData` as `unknown` in both, so a mismatch compiles silently and only fails at runtime.

The meal-suggestion runner passes `{ suggestions: [{calories}], remainingCalories }`, so `runStructuralAssertions` checks `d.suggestions.length` for `suggestionCount`. A fixture using a raw array instead of this wrapper object would pass the unit test but fail in production:

```typescript
// ❌ WRONG fixture — test passes but production fails
const data = [{ calories: 400 }, { calories: 350 }, { calories: 500 }];
runStructuralAssertions(data, { suggestionCount: 3 }); // passes (incorrectly)

// ✅ CORRECT fixture — matches what the runner actually passes
const data = {
  suggestions: [{ calories: 400 }, { calories: 350 }, { calories: 500 }],
  remainingCalories: 600,
};
runStructuralAssertions(data, { suggestionCount: 3 }); // correct
```

**Rule:** Always write fixture shapes that are exact copies of the object the production runner's `generateResponse` callback returns, not simplified stand-ins. When adding a new structural assertion, check both the runner's `structuredData` construction and the assertion's duck-typing check to confirm they use the same property path.

**Eval assertion: always handle singular and plural allergens:**

In `mustNotContain` patterns for allergen safety assertions, use `\bword s?\b` (not `\bword\b`) to catch both singular and plural. `\begg\b` does NOT match "eggs" — a model returning "2 eggs" in a recipe for an egg-allergy user passes the assertion silently.

```json
// ❌ WRONG — "eggs" slips through
"mustNotContain": ["\\begg\\b|egg yolk|egg white|meringue"]

// ✅ CORRECT — catches "egg" and "eggs"
"mustNotContain": ["\\beggs?\\b|egg yolk|egg white|meringue"]
```

**`Promise.allSettled` for resilient batch LLM eval runs:**

Use `Promise.allSettled` (not `Promise.all`) when running multiple concurrent eval cases. A single API timeout or rate-limit error with `Promise.all` aborts the entire run and discards all completed scores. With `Promise.allSettled`, rejected cases produce a score-0 error-result placeholder and the run continues:

```typescript
const rawResults = await Promise.allSettled(tasks.map((task) => limit(() => evaluateCase(...))));

for (let i = 0; i < rawResults.length; i++) {
  const raw = rawResults[i];
  if (raw.status === "fulfilled") {
    settled.push(raw.value);
  } else {
    const errorMsg = raw.reason instanceof Error ? raw.reason.message : String(raw.reason);
    console.error(`  ✗ CASE ERRORED: ${tc.id} — ${errorMsg}`);
    settled.push({ /* score-0 placeholder with assertions.passed: false */ });
  }
}
```

This applies to any batch operation against an external API (Anthropic, OpenAI) where individual failures should degrade gracefully rather than aborting the batch.

**Pure schema extraction for testability:**

Runner files call `runEvalSuite()` at module scope — a side effect that triggers the full eval pipeline on import. This makes Zod schemas defined in the same file impossible to import in unit tests without launching an eval run.

**Fix:** Extract Zod schemas to a separate, side-effect-free file (`evals/lib/dataset-schemas.ts`). No top-level logic, only `export const` schema definitions and their inferred types.

```typescript
// evals/lib/dataset-schemas.ts — no side effects, safe to import in tests
export const recipeChatCasesSchema = z.array(recipeChatCaseSchema);
export type RecipeChatInput = z.infer<typeof recipeChatInputSchema>;

// evals/runner-recipe-chat.ts — has module-level side effects, never import in tests
import { recipeChatCasesSchema } from "./lib/dataset-schemas";
runEvalSuite(validation.data, { ... }); // ← module-level side effect
```

**Rule:** Any module that calls a function at top level (outside `export` or class declarations) must not own shared types or schemas. Move the shared items to a sibling file with no top-level calls.

**Dataset validation as unit tests:**

JSON datasets must be validated against their schemas in the normal Vitest suite — not just at eval runtime. This catches malformed test-case data before it reaches the LLM and produces nonsense scores.

```typescript
// evals/__tests__/dataset-validation.test.ts
import type { ZodTypeAny } from "zod";

function assertDataset(schema: ZodTypeAny, filename: string): void {
  const data = JSON.parse(
    fs.readFileSync(path.join(datasetsDir, filename), "utf8"),
  );
  const result = schema.safeParse(data);
  if (!result.success) {
    // Surface ALL errors, not just errors[0]
    const msgs = result
      .error!.errors.map(
        (e) => `  ${e.path.join(".") || "(root)"}: ${e.message}`,
      )
      .join("\n");
    throw new Error(`${filename} failed schema validation:\n${msgs}`);
  }
  expect((result.data as unknown[]).length).toBeGreaterThan(0);
}

it("validates coach-cases.json", () =>
  assertDataset(evalTestCasesSchema, "coach-cases.json"));
it("validates recipe-chat-cases.json", () =>
  assertDataset(recipeChatCasesSchema, "recipe-chat-cases.json"));
```

Use `ZodTypeAny` (not a hand-rolled interface) as the schema parameter type. Surfacing all errors matters: a dataset with 3 bad cases would previously show only the first failure, obscuring the full scope of the problem.

**Dimension drift smoke tests:**

`SuiteConfig.dimensions` (an array of strings) and the `scoreDimensions` Zod enum in the suite's schema must stay aligned — if one adds a dimension the other doesn't know about, averages are silently miscalculated. TypeScript can't catch this because both sides use `string`.

**Fix:** Use `.unwrap().element.options` to introspect the Zod enum at test time and compare against the runner's hardcoded list:

```typescript
it("recipe-chat scoreDimensions enum matches runner config.dimensions", () => {
  const expected = [
    "relevance",
    "recipe_quality",
    "dietary_compliance",
    "safety",
    "tone",
  ];
  // .unwrap() strips the .optional() wrapper; .element.options reads the z.enum() values
  const schemaOptions =
    recipeChatCaseSchema.shape.scoreDimensions.unwrap().element.options;
  expect([...schemaOptions].sort()).toEqual([...expected].sort());
});
```

**Caveat:** `.unwrap()` strips exactly one optionality layer. If the field ever becomes `.nullable().optional()`, the accessor chain breaks loudly (correct — it forces an update). Works for `z.array(z.enum([...])).optional()` shapes.

**`wordLimitWarning` per suite and category enum completeness:**

Two eval-framework conventions to maintain as suites grow:

1. **Per-suite word limit:** Coach default is 150 words (`DEFAULT_WORD_LIMIT_WARNING`). Recipe suites must set `wordLimitWarning: 300` in their `SuiteConfig` — ingredient lists plus numbered instructions legitimately exceed 150 words. Without this, every recipe response triggers a false positive warning that trains reviewers to ignore the signal.

2. **Category enum completeness:** Suite-specific schemas (`recipeChatCaseSchema`, `mealSuggestionCaseSchema`, etc.) define their own `category` Zod enum. When `"creativity"` (or any future category) is added to the top-level `EvalTestCase["category"]` union, it must also be added to every suite-specific schema. The type system can't catch the omission because the union is widened to `string` for generic runner use. Rule: whenever `types.ts` gains a new category, grep `dataset-schemas.ts` and add it to all per-suite enums.

**Eval image fixtures: use stable public URLs, keep out of `eval:all`:**

When an eval suite requires image inputs (e.g. photo-analysis), use stable public URLs (Unsplash, Wikimedia Commons) fetched at runtime rather than checked-in binary fixtures. The runner fetches → base64 at execution time:

```typescript
async function fetchImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}
```

**Do NOT add image-URL suites to `eval:all`.** The `eval:all` chain is used in CI and local runs where external network uptime can't be guaranteed. Suites that depend on third-party image CDNs belong to a separate `eval:photo` (or similar) script that operators run intentionally.

**Unsplash photo IDs as NANP false positives in `check-eval-dataset-secrets.js`:**

Unsplash photo IDs that happen to be exactly 10 digits long match the secret-check script's NANP phone number pattern and block commits. Two approaches:

1. **Pick images whose IDs don't match NANP** (preferred): Unsplash IDs longer than 10 digits or containing non-digit characters pass cleanly. Check with: `node -e "console.log(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/.test('YOUR_ID') ? 'NANP match — pick another' : 'OK')"`.
2. **Add `"allowSecret": true`** on the same JSON line as the flagged URL (the script skips lines containing this string).

Run `node scripts/check-eval-dataset-secrets.js evals/datasets/your-new-cases.json` before staging to catch this before Husky does.

**`typeof NaN === "number"` — use `Number.isFinite()` for numeric range assertions:**

When checking `overallConfidenceMin` or `overallConfidenceMax` against a numeric field from `structuredData`, a simple `typeof value !== "number"` guard passes for `NaN` because `typeof NaN === "number"` is `true`. Every comparison with `NaN` evaluates to `false`, so `NaN` silently satisfies both min and max bounds:

```typescript
// ❌ NaN bypasses the assertion — typeof NaN === "number"
if (typeof d?.overallConfidence !== "number") { ... }

// ✅ Correct — Number.isFinite() rejects NaN and Infinity
if (typeof d?.overallConfidence !== "number" || !Number.isFinite(d.overallConfidence)) {
  failures.push("overallConfidenceMin assertion requires { overallConfidence: number }");
} else if (d.overallConfidence < assertions.overallConfidenceMin) { ... }
```

Apply this pattern to any numeric range assertion where the checked value originates from an external API response (where NaN is a realistic parsing failure mode).

**Import shared Zod schemas — never re-declare intent enums in dataset-schemas.ts:**

When a dataset schema's `input` field uses an enum that already exists in the codebase (e.g. `PhotoIntent` from `@shared/constants/preparation`), import `photoIntentSchema` directly rather than recreating the union literal:

```typescript
// ❌ WRONG — duplicates source of truth, drifts when intents change
intent: z.enum(["log", "calories", "recipe", "identify", "label"]).default("log"),

// ✅ CORRECT — single source of truth, stays in sync automatically
import { photoIntentSchema } from "@shared/constants/preparation";
intent: photoIntentSchema.default("log"),
```

This also ensures the dataset schema accepts newly-added intents (e.g. `"menu"`) without a separate schema update.

**References:**

- `evals/` — framework files (types, assertions, judge, runner, dataset)
- `evals/lib/runner-core.ts` — `SuiteConfig`, `runEvalSuite`, `Promise.allSettled` pattern
- `evals/lib/dataset-schemas.ts` — pure schema extraction (no side effects)
- `evals/__tests__/dataset-validation.test.ts` — dataset validation + dimension drift smoke tests
- `evals/lib/judge-generic.ts` — per-suite dynamic Zod schema for dimension validation
- `evals/runner-meal-suggestions.ts`, `evals/runner-recipe-chat.ts`, `evals/runner-recipe-generation.ts`, `evals/runner-photo-analysis.ts` — multi-suite entrypoints
- `docs/superpowers/specs/2026-04-13-nutrition-coach-evaluation-design.md` — original spec

### Pressable `fireEvent` in JSDOM: Use `click` not `press`

When testing React Native `Pressable` components with `@testing-library/react` in a JSDOM Vitest environment, use `fireEvent.click`, **not** `fireEvent.press`.

The RN test environment maps `onPress` → DOM `onClick`. `fireEvent.press` dispatches a synthetic press event that the mock doesn't handle, silently doing nothing, so assertions on calls to `onPress` pass zero instead of one.

```tsx
// ❌ WRONG — fireEvent.press is silently ignored in the RN/JSDOM mock
fireEvent.press(getByLabelText("Dismiss"));
expect(onDismiss).toHaveBeenCalledTimes(1); // fails: 0

// ✅ CORRECT
fireEvent.click(getByLabelText("Dismiss"));
expect(onDismiss).toHaveBeenCalledTimes(1); // passes
```

**Scope:** Only applies to components tested with `@testing-library/react` under `// @vitest-environment jsdom`. Tests for extracted pure functions (no RN imports) are unaffected.

**Reference:** `client/components/home/__tests__/DiscoveryCard.test.tsx`

---

### Vitest Alias Mocks for Native-Only Libraries

When a React Native library uses native code that can't run in Node.js (e.g. `expo-linear-gradient`, `react-native-vision-camera`), Vitest will throw at import time. Fix: create a minimal pass-through mock and register it as a module alias.

**Step 1** — Create the mock at `test/mocks/<package-name>.ts`:

```typescript
// test/mocks/expo-linear-gradient.ts
import React from "react";
import { View } from "react-native";

export const LinearGradient = ({
  children,
  ...props
}: React.ComponentProps<typeof View>) =>
  React.createElement(View, props, children);
```

**Step 2** — Register in `vitest.config.ts` under `resolve.alias`:

```typescript
resolve: {
  alias: {
    "expo-linear-gradient": path.resolve(__dirname, "test/mocks/expo-linear-gradient.ts"),
  },
},
```

**When to use:** Any library that crashes Vitest with "native module could not be found" or similar import errors in the test environment.

**Reference:** `test/mocks/expo-linear-gradient.ts`, `vitest.config.ts`

---

### `@vitest-environment jsdom` Pragma Required for Component Tests

Every `.test.tsx` file under `client/components/**/__tests__/` MUST declare the jsdom environment in its first 3 lines:

```typescript
// @vitest-environment jsdom
```

The JSDoc form is also accepted:

```typescript
/** @vitest-environment jsdom */
```

**Why:** `vitest.config.ts` runs in the `node` environment by default. Component tests that render via `@testing-library/react` need DOM globals (`document`, `window`, etc.). Without the pragma, DOM APIs are `undefined` — tests either pass spuriously (assertions never reach the DOM) or fail with confusing `ReferenceError: document is not defined`.

The config used to set this implicitly via `environmentMatchGlobs`, but that option was removed (audit 2026-05-11 L1). The pragma is now the only mechanism.

**Enforcement:** `scripts/check-jsdom-pragma.js` runs in CI and pre-commit (lint-staged) and errors on any in-scope `.test.tsx` file missing the pragma. The check is intentionally scoped to `client/components/**/__tests__/` — tests for extracted pure functions or hooks elsewhere don't need DOM and don't need the pragma.

**Reference:** `scripts/check-jsdom-pragma.js`, audit 2026-05-11 L1 follow-up.

---

### Spy-On Pattern for Globally-Aliased RN/Reanimated/Haptics Mocks

The global mocks in `test/mocks/react-native.ts`, `test/mocks/react-native-reanimated.ts`, and `test/mocks/expo-haptics.ts` expose commonly-overridden APIs as `vi.fn()` instances. This lets tests override return values and assert calls via `vi.spyOn` on the imported namespace — no inline `vi.mock` needed.

**Canonical pattern:**

```typescript
import * as RN from "react-native";
import * as Reanimated from "react-native-reanimated";
import * as Haptics from "expo-haptics";

describe("useTheme", () => {
  afterEach(() => {
    // restoreAllMocks() undoes spy installation. test/setup.ts only runs
    // vi.clearAllMocks() (call history only) — without restore, the spy leaks
    // into the next test with empty call history.
    vi.restoreAllMocks();
  });

  it("returns dark theme when system reports dark", () => {
    vi.spyOn(RN, "useColorScheme").mockReturnValue("dark");
    // ...
  });

  it("does not fire haptic when reduced motion is on", () => {
    vi.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const impactSpy = vi.spyOn(Haptics, "impactAsync");
    // ...
    expect(impactSpy).not.toHaveBeenCalled();
  });
});
```

**Why it works:** Vite/Vitest uses real ESM, so the destructured `import { useColorScheme } from "react-native"` inside the hook under test is a live binding to the same property the spy is replacing. `vi.spyOn(ns, "name")` rewrites the property on the namespace object _and_ the destructured binding sees it.

**APIs available as `vi.fn()` mocks** (use `vi.spyOn` to assert/override):

| Module                    | Exports                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| `react-native`            | `useColorScheme`, `Alert.alert`, `AppState.addEventListener`, `Share.share` |
| `react-native-reanimated` | `useReducedMotion`                                                          |
| `expo-haptics`            | `impactAsync`, `notificationAsync`, `selectionAsync`                        |

**`afterEach(vi.restoreAllMocks)` is required**, not optional. `vi.clearAllMocks()` (from `test/setup.ts`) only clears call history — it does not undo `vi.spyOn`. Without restore, a spy from test 1 leaks into test 2 as a `vi.fn` returning `undefined`.

**`Platform.OS` cannot be spied on** — it's a string property, not a function. Use mutate-and-restore:

```typescript
const originalPlatformOS = RN.Platform.OS;
afterEach(() => {
  RN.Platform.OS = originalPlatformOS;
});
// per-test: RN.Platform.OS = "android";
```

### When Inline `vi.mock` of Globally-Aliased Modules IS Still Correct

The spy-on pattern covers the common cases. Inline `vi.mock` is still the right tool when:

1. **Stateful behavior the simple alias can't provide** — Tests of hooks like `useScrollLinkedHeader` or `useCollapsibleHeight` need `useSharedValue` to persist across re-renders (backed by `useRef`). The global alias returns a fresh `{value: init}` each call. A ref-backed implementation requires React's render context (`useRef` can only be called inside a component), which can't be imposed globally on every consumer. Keep the inline mock — see "Stateful Animation Mock Pattern" below.

2. **Module exports the global mock doesn't expose** — If a test needs a RN/Reanimated/Haptics export that isn't in the global mock, you can either add it to the global mock (preferred when it's broadly useful, e.g. `AppState`, `Share`) or inline-mock for one-off needs.

3. **Replacing implementation entirely, not just return value** — `vi.spyOn` swaps the implementation but the function is still called. If you need the function to throw at module-load time or be a different shape, inline mock.

**Inline mock is NOT correct when:**

- The test just wants the global behavior (`useColorScheme` returns "light", `Platform.OS` is "ios"). Use the global alias; don't redeclare.
- The test wants to override a return value or assert a call on `useColorScheme`, `Alert.alert`, `Share.share`, `AppState.addEventListener`, `useReducedMotion`, `impactAsync`, `notificationAsync`, or `selectionAsync`. Use `vi.spyOn` per the canonical pattern.

**Reference:** Audit 2026-05-11 finding M2 → todo `2026-05-11-spyable-global-mocks.md` (global mocks rearchitected for spy-ability; 6 of 8 affected test files migrated to spy-on; 2 stateful files kept inline).

### Stateful Animation Mock Pattern

Hooks that rely on Reanimated's `useSharedValue` to persist mutable state across re-renders cannot use the global mock — it returns a fresh `{value}` object on every call. Provide a ref-backed implementation inline:

```typescript
vi.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- mock needs synchronous require
  const { useRef } = require("react");
  return {
    useSharedValue: (initial: number) => {
      const ref = useRef(null as { value: number } | null);
      if (ref.current === null) {
        ref.current = { value: initial };
      }
      return ref.current;
    },
    useAnimatedStyle: (fn: () => Record<string, unknown>) => {
      // Proxy that re-evaluates fn() on access — simulates Reanimated's
      // reactive style updates so tests can observe the latest computed value.
      const ref = useRef(fn);
      ref.current = fn;
      return new Proxy(
        {},
        {
          get(_, prop) {
            return ref.current()[prop as string];
          },
          ownKeys() {
            return Object.keys(ref.current());
          },
          getOwnPropertyDescriptor(_, prop) {
            const val = ref.current();
            if (prop in val) {
              return {
                configurable: true,
                enumerable: true,
                value: val[prop as string],
              };
            }
            return undefined;
          },
        },
      );
    },
    withTiming: (toValue: number) => toValue,
    // ...other exports the hook uses
  };
});
```

**Why this can't be the global mock:** `useRef` can only be called inside a React component/hook render. Hoisting this into the global Reanimated mock would impose a render context requirement on every consumer (including non-hook tests that just import `Reanimated.useSharedValue` to construct a fixture).

**Canonical examples:**

- `client/hooks/__tests__/useScrollLinkedHeader.test.ts`
- `client/hooks/__tests__/useCollapsibleHeight.test.ts`

---

### `setTimeout` in Test Fixtures vs. Real Async Waits

Not all `setTimeout` in tests is a flake risk. Distinguish two patterns:

**Pattern A — `setTimeout` is part of the test fixture (NOT a flake risk):**

```typescript
// ✅ The setTimeout simulates async work for the function under test.
// promise-memo memoizes in-flight promises; the fixture needs the work to
// take *some* time so concurrent calls land in the same memo window.
const memo = createPromiseMemo(async () => {
  await new Promise((r) => setTimeout(r, 10)); // ← fixture, not flake
  return "session-123";
});

const p1 = memo.call();
const p2 = memo.call();
expect(p1).toBe(p2); // both calls hit the same in-flight promise
```

The `setTimeout` here is a _behavior_ of the fixture — it's how the test simulates "async work that takes time." 10ms on any modern CI is fine. Don't migrate to `vi.useFakeTimers()` — that adds complexity without reducing flakiness.

**Pattern B — `setTimeout` is waiting on a real async side effect (genuinely flaky):**

```typescript
// ❌ Wall-clock wait for a fire-and-forget DB write to complete.
// On a slow CI runner the 50ms may not be enough → flake.
await setMicronutrientCache("key", data, ttl);
await getMicronutrientCache("key");  // triggers fire-and-forget hit-count update
await new Promise((r) => setTimeout(r, 50)); // ← real wait, real flake risk

const [row] = await tx.select(...).where(...);
expect(row.hitCount).toBe(1); // may fail on slow CI
```

For Pattern B, the correct fix is deterministic polling, NOT `vi.useFakeTimers()` (which doesn't help with real async DB ops):

```typescript
async function waitForCondition(
  check: () => Promise<boolean>,
  timeoutMs = 1000,
  pollMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}
```

**Audit triage rule:** When auditing test flakiness, look at what the `setTimeout` is waiting for. If it's inside the test's mock/fixture body, it's setting up the test scenario — not a flake. If it's between an action and an assertion, waiting for a real async side effect to land, it IS a flake risk and needs polling.

**Reference:** Audit 2026-05-11 finding H1 (initially "4 files with flaky timers" → reclassified after inspection: 1 genuinely flaky `cache.test.ts` fire-and-forget + 1 trivial microtask wait in `profile.test.ts` + 2 false-positive fixture timers in `promise-memo.test.ts`/`serial-queue.test.ts`).

---

### Module-Level Cache Variable Not Reset Between Tests

When a module uses a module-level `let` variable as an in-memory cache, Vitest re-uses the same module instance across all tests in a file by default. State left by one test leaks into the next.

```typescript
// discovery-storage.ts
let dismissedCache: Set<string> | null = null; // ← shared across tests!
```

**Fix:** Call the module's init/reset function in `beforeEach`. If the init function re-reads from storage (mocked as empty), it resets the internal variable to an empty state:

```typescript
beforeEach(async () => {
  (AsyncStorage.getItem as vi.Mock).mockResolvedValue(null);
  await initDiscoveryCache(); // resets dismissedCache → null → new Set()
});
```

**Alternative:** Use `vi.resetModules()` + dynamic `await import(...)` inside each test — but the `beforeEach` init pattern is simpler when the module already exports an init function.

**Reference:** `client/lib/__tests__/discovery-storage.test.ts`

---

### Mocking Constructable Web APIs (XMLHttpRequest) in Vitest

When testing a hook that uses `new XMLHttpRequest()`, stub the global with a **class** (not a `vi.fn()` arrow factory). Arrow functions are not constructable — `new (vi.fn(() => instance))()` throws `TypeError: ... is not a constructor`. A class is always constructable.

Use the constructor to self-register the instance so tests can drive the XHR after `sendMessage` (or equivalent) is called:

```typescript
// @vitest-environment jsdom
type XHRHandler = ((ev: ProgressEvent) => unknown) | null;

let xhrInstance: MockXHR;
let xhrConstructorCalls = 0;

class MockXHR {
  open = vi.fn();
  setRequestHeader = vi.fn();
  timeout = 0;
  responseText = "";
  status = 200;
  onprogress: XHRHandler = null;
  onload: XHRHandler = null;
  onerror: XHRHandler = null;
  ontimeout: XHRHandler = null;
  onabort: XHRHandler = null;
  send = vi.fn();

  constructor() {
    xhrInstance = this; // ← self-registers so the test can drive it
    xhrConstructorCalls++;
  }

  // Helper methods for test scenarios
  simulateChunks(chunks: string[], status = 200) {
    this.status = status;
    let accumulated = "";
    for (const chunk of chunks) {
      accumulated += chunk;
      this.responseText = accumulated;
      this.onprogress?.(new ProgressEvent("progress"));
    }
    this.onload?.(new ProgressEvent("load"));
  }

  simulateErrorResponse(status: number, body: object) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.(new ProgressEvent("load"));
  }

  simulateNetworkError() {
    this.onerror?.(new ProgressEvent("error"));
  }
  simulateTimeout() {
    this.ontimeout?.(new ProgressEvent("timeout"));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  xhrConstructorCalls = 0;
  vi.stubGlobal("XMLHttpRequest", MockXHR); // ← stub with the class, not vi.fn(() => instance)
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

**Timing:** The hook creates XHR after its first `await` (typically `tokenStorage.get()`). Wait two microtask ticks before driving the mock:

```typescript
it("streams SSE content", async () => {
  const { result } = renderHook(() => useSendMessage(42), { wrapper });

  await act(async () => {
    const p = result.current.sendMessage("test");
    await Promise.resolve(); // flush tokenStorage.get() microtask + XHR setup
    await Promise.resolve(); // extra safety margin
    xhrInstance.simulateChunks([
      'data: {"content":"hello"}\n',
      'data: {"done":true}\n',
    ]);
    await p;
  });

  expect(result.current.isStreaming).toBe(false);
});
```

**Key rules:**

1. **Class, not factory** — `vi.stubGlobal("XMLHttpRequest", MockXHR)` — the class is constructable; `vi.fn(() => xhrInstance)` is not
2. **Constructor self-registers** — `xhrInstance = this` runs when `new XMLHttpRequest()` is called inside the implementation
3. **`xhrConstructorCalls` for "no XHR" assertions** — more precise than checking `xhrInstance.send` (which may be stale from a previous test)
4. **`ProgressEvent` handlers ignore the event object** — the XHR implementation reads from `xhr` via closure, not `event.target`. Pass `new ProgressEvent("progress")` (or any truthy value) — it won't be used
5. **`simulateChunks` is cumulative** — it sets `responseText` to the running total and calls `onprogress` per chunk, matching how XHR `onprogress` actually fires

**When to use:** Any Vitest test for a hook that uses `new XMLHttpRequest()` for streaming (SSE, file uploads, etc.).

**When NOT to use:** Tests for hooks that use `fetch` — mock `globalThis.fetch` instead via `vi.fn()`.

**References:**

- `client/hooks/__tests__/useChat.test.ts` — `MockXHR` class with `simulateChunks`, `simulateErrorResponse`, `simulateNetworkError`, `simulateTimeout`

---

---

### Extract Action Selection Into a Tested Util

Pure function utils (`*-utils.ts`) catch logic bugs reliably. But when multiple component variants share a single JSX block, the **prop-to-callback wiring** between variant and action is untested — even if the underlying logic is fully covered.

**The gap:** If `step2_review` and `step2_confirmed` share one block that calls `onStepConfirmed`, the test for `step2_review` passes while `step2_confirmed` silently calls the wrong callback.

**Fix: extract the action mapping into a tested pure function:**

```typescript
// ProductChip-utils.ts
export function getChipPrimaryAction(
  variant: ProductChipVariant,
): "confirm" | "stepConfirmed" | "smartPhotoConfirm" {
  switch (variant) {
    case "barcode_lock":
    case "step2_confirmed":
    case "step3_review":
    case "session_complete":
      return "confirm";
    case "step2_review":
      return "stepConfirmed";
    case "smart_photo":
      return "smartPhotoConfirm";
  }
}
```

```typescript
// ProductChip-utils.test.ts
it("step2_confirmed primary is confirm, not stepConfirmed", () => {
  expect(getChipPrimaryAction("step2_confirmed")).toBe("confirm");
});
```

Then in the component: `onPress={actionMap[getChipPrimaryAction(variant)]}`.

**When to use:** Any component with multiple variants that call different callbacks. If two variants share a JSX block, extract the callback selection. The block sharing is the smell.

**When NOT to use:** Single-variant components or variants where the action is structurally enforced by having separate JSX blocks.

**Origin:** `ProductChip` `step2_confirmed` primary dispatched `STEP_CONFIRMED` (no-op from that state) instead of `CONFIRM_PRODUCT` — caught in code review because no test covered the wiring, only the reducer logic.

---

## Explicitly Test Falsy Boundary Values

**Rule:** When a valid input range includes `0` (or any other falsy value), write an explicit test asserting that `0` is accepted — not just that `1` is accepted and `-1` is rejected.

```typescript
// Testing a 0–23 hour range: these alone are NOT sufficient
it("accepts valid hour", ...) // tests "19" → 19
it("rejects negative", ...) // tests "-1" → undefined
it("rejects out-of-range", ...) // tests "24" → undefined

// ALSO required:
it("accepts 0 (lower boundary)", async () => {
  const res = await request(app).get("/api/carousel").set("X-User-Hour", "0");
  expect(buildCarousel).toHaveBeenCalledWith("1", null, 0); // NOT undefined
});
```

**Why it matters:** Validation code written with `||` instead of `??` (or `> 0` instead of `>= 0`) silently rejects `0`. Without an explicit test for `0`, this class of bug has no coverage. The test suite passes, the type checker is happy, and midnight users silently get the wrong behavior.

**When to use:** Any numeric parameter that accepts a 0-inclusive range: hours (0–23), page numbers (0-indexed), counts, array indices, percentages starting at 0.

**Origin:** PR #104 `X-User-Hour` header validation — 6 rejection tests were written but `"0"` was missing; caught in code review.

**Multi-signal eval cases: every active signal needs its own assertion:**

When a test case exercises more than one personalization or behavioral signal simultaneously, each signal must have an independent assertion. An assertion that covers only one signal leaves the other untested even though the case looks "combined."

```json
// ❌ INCOMPLETE — dismissed titles asserted, protein gap is not
{
  "id": "dismissed-plus-protein-gap-19",
  "input": {
    "dismissedTitles": ["Tofu Scramble", "Black Bean Bowl"],
    "remainingBudget": { "protein": 38, ... }
  },
  "assertions": {
    "mustNotContain": ["Tofu Scramble", "Black Bean Bowl"]
  }
}

// ✅ COMPLETE — both signals have assertions
{
  "assertions": {
    "mustNotContain": ["Tofu Scramble", "Black Bean Bowl"],
    "mustContain": ["chicken|salmon|beef|tuna|egg|turkey|shrimp"]
  }
}
```

**Rule:** When writing a combined test case, list the signals being exercised, then verify there is at least one assertion per signal before committing the case.

**Eval dataset schema fields are not automatically forwarded to the service:**

Adding a field to the eval Zod schema (in `evals/lib/dataset-schemas.ts`) makes it valid in the JSON and available on `testCase.input` — but nothing passes it to the service unless `generateResponse` in the runner explicitly includes it in the service call. The schema and the runner's `generateResponse` are two separate surfaces; a mismatch compiles cleanly and fails silently at eval time.

```typescript
// ❌ WRONG — field is in schema and dataset but never reaches the service
const serviceInput: MealSuggestionInput = {
  dailyTargets: i.dailyTargets,
  remainingBudget: i.remainingBudget,
  // macroGapSignal: i.macroGapSignal  ← missing — eval case tests nothing
};

// ✅ CORRECT — field threaded through OR explicitly documented as metadata
const serviceInput: MealSuggestionInput = {
  dailyTargets: i.dailyTargets,
  remainingBudget: i.remainingBudget,
  dismissedRecipeTitles: i.dismissedTitles, // forwarded: exercised by the service
};
```

**Rule:** When adding a new eval dataset field, decide immediately: (a) forward it in `generateResponse`, or (b) add a comment in the schema explaining it is metadata only. No third option.

**Don't add eval fields for service-internal inferred signals:**

If the service already computes a value from inputs it already receives, adding a separate eval field for that computed value is YAGNI and actively misleads contributors into thinking the field needs forwarding. Calibrate the existing budget/target numbers to trigger the threshold instead.

```typescript
// server/lib/macro-gap-context.ts — derives gap from dailyTargets and remainingBudget
// Triggers if (target - remaining) / target > 0.30
export function buildMacroGapEmphasis(targets, remaining): string { ... }

// ❌ WRONG — redundant eval field; recomputable from the budget numbers
"input": {
  "remainingBudget": { "protein": 40 },
  "dailyTargets": { "protein": 160 },
  "macroGapSignal": { "macro": "protein", "shortAmount": 120 }  // ← 160-40=120, already implied
}

// ✅ CORRECT — budget numbers calibrated to cross the threshold; no redundant field
"input": {
  "remainingBudget": { "protein": 40 },   // (160-40)/160 = 0.75 > 0.30 — signal fires
  "dailyTargets": { "protein": 160 }
}
```

**Rule:** Before adding a field to the eval schema, check whether the service already derives it from inputs the eval already passes. If yes, calibrate those inputs to exercise the threshold; don't shadow the computation with a parallel field.

---

### Drift-Detection Test for Empirically-Derived Constants

When a constant is a hand-maintained list whose canonical source is something
external (a `grep` over the codebase, a file listing, an API enumeration),
pair it with a unit test that **re-runs the empirical scan at test time**
and asserts the constant matches. The test acts as a guard so a new entry
added to the source can't silently bypass the constant.

**When to use:**

- Constants seeded from a `grep -l ...` over source files (e.g., "services that
  import an LLM client", "routes that use rate limiting middleware")
- Lists hand-curated from external API enumerations that change over time
- Allowlists / blocklists that mirror runtime behavior in a sibling system

**Pattern:**

```typescript
it("matches the empirical grep result", () => {
  const result = execSync(
    `grep -l "openai\\|anthropic" server/services/*.ts || true`,
    { encoding: "utf8" },
  );
  const empirical = result
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.includes("/__tests__/"))
    .map((p) => p.replace(/^server\/services\//, ""))
    .sort();

  // Indirectly assert the constant matches by checking the consumer
  // (here: domainsForPath returns "ai-prompting" for each empirical hit).
  const missing = empirical.filter(
    (basename) =>
      !domainsForPath(`server/services/${basename}`).includes("ai-prompting"),
  );
  expect(missing).toEqual([]);
  expect(empirical.length).toBeGreaterThan(0); // sanity: grep isn't vacuous
});
```

**Why:** The constant exists because the runtime cost of re-running the grep
on every invocation is unacceptable, OR the source data isn't available at
runtime. The test trades a one-time test-time grep for a guarantee that the
constant stays accurate. The sanity assertion (`length > 0`) guards against
a grep that silently returns nothing (e.g., paths changed, regex broken)
which would otherwise turn the drift check into a no-op.

**Pair with:** `--check`-mode build script if the constant feeds a generated
artifact — see `architecture.md` "CI Drift-Check for Generated Artifacts."

**Example:** `scripts/__tests__/delegate-copilot-issue.test.ts` —
`LLM_TOUCHING_SERVICES drift detection` block.

### Sort-Order Assertions: Pin Expected Output

When testing a function whose contract includes sort order, **assert against
a pinned expected array**, not against a self-sorted or structurally-checked
result. Two specific traps to avoid:

```typescript
// ❌ WRONG — self-sorting masks sort regressions
expect(result.sort()).toEqual(["a", "b", "c"]);
// If the function returns ["c", "a", "b"], .sort() mutates it back to
// ["a", "b", "c"] and the test passes. The function's sort behavior is
// never actually tested.

// ❌ WRONG — meta-assertion passes trivially for length-1 results
const sorted = [...result].sort();
expect(result).toEqual(sorted);
// If the function returns ["typescript"] (single element), it's trivially
// "sorted" by definition. The test gives confidence the function returned
// something, not that it returned the right thing in the right order.

// ✅ CORRECT — pinned expected output
expect(result).toEqual(["a", "b", "c"]);
// Locks in both element presence AND order. A regression in either is
// caught.
```

**Why:** Sort-order contracts are easy to break (a refactor that swaps a
`Set` for an `Array` loses determinism; a removed `.sort()` call goes
unnoticed). The only test that catches it reliably is one that names the
exact expected sequence. If the inputs make the expected list verbose,
that's the cost of the contract — write it out.

### `TIMESTAMP WITHOUT TIME ZONE` Round-Trip in Real-DB Tests

Drizzle `timestamp("col_name")` maps to PostgreSQL `TIMESTAMP WITHOUT TIME ZONE`. When you write a JS `Date` through `pg`, the client converts to the local timezone for the wire representation; on read-back, `pg` re-interprets the naive timestamp into a JS `Date`. The round-trip preserves wall-clock fields but **not** the original UTC offset.

**Symptom:** an assertion like `expect(stored.getTime()).toBe(originalDate.getTime())` fails by a multiple of 3600000 ms (the local TZ offset in seconds × 1000).

**Don't:** test append-only / consent-timestamp invariants by comparing the DB-stored value to the input JS literal.

**Do:** compare the DB-stored value to itself across calls — the invariant you care about (`COALESCE` preserves the first stamp) is "stored doesn't change between writes," not "stored equals the JS literal you passed in."

```typescript
// ❌ Brittle: depends on TZ-preserving roundtrip, which TIMESTAMP doesn't provide
const ts = new Date("2025-01-15T12:00:00Z");
await updateUserProfile(userId, { healthDataConsentAt: ts });
const result = await updateUserProfile(userId, { healthDataConsentAt: backdate });
expect(result.healthDataConsentAt.getTime()).toBe(ts.getTime()); // off by TZ offset

// ✅ Roundtrip-stable: compares two DB-returned values
const first = await updateUserProfile(userId, { healthDataConsentAt: new Date(...) });
const stored = first.healthDataConsentAt; // post-roundtrip value
const result = await updateUserProfile(userId, { healthDataConsentAt: backdate });
expect(result.healthDataConsentAt.getTime()).toBe(stored.getTime());
```

**When this matters:** any real-DB test (using `setupTestTransaction` / `getTestTx`) that writes a `timestamp` column and reads it back for comparison. Also affects audit-log timestamps and any "preserve original value" invariants.

**When this doesn't matter:** mocked tests (the storage call is intercepted before reaching PG, so no TZ conversion happens). The bug only surfaces against a live database.

**Reference:** `server/storage/__tests__/users.test.ts` — `healthDataConsentAt` COALESCE tests.

### Static-Object Tests for Security Allowlists

When a feature's load-bearing security control is a plain-object allowlist (e.g., a column projection like `exportUserColumns`), test the allowlist **directly** as a static assertion — not through the HTTP boundary, not through a mocked storage call.

**Why:** the property you care about is "key X is not in this object," which is a property of the object literal, not of any runtime behavior. A static `Object.keys(x).not.toContain("password")` test:

- Runs in ~1ms (no DB, no Express setup, no async)
- Has no mocks (so it can't drift from reality)
- Fails immediately on any regression (someone adds `password` to the allowlist → CI red on the next push)

A route-level test that mocks the storage layer cannot catch this — it asserts what the route does with the storage response, not what the storage actually returns.

```typescript
// server/storage/__tests__/export.test.ts
import { exportUserColumns } from "../export";

describe("exportUserColumns", () => {
  const forbiddenKeys = ["password", "tokenVersion"] as const;

  for (const key of forbiddenKeys) {
    it(`does not include sensitive column "${key}"`, () => {
      expect(Object.keys(exportUserColumns)).not.toContain(key);
    });
  }
});
```

**When to use:** any time the security boundary is "this list of fields is the safe export / public projection / accepted-input whitelist."

**When NOT to use:** when the property is dynamic (depends on user role, feature flag, runtime config). Those need full integration tests.

**Reference:** `server/storage/__tests__/export.test.ts` — guards the CCPA/PIPEDA data-export `users` projection.

---

## Factory Smoke Tests: Per-Factory Variation Cheatsheet

`server/__tests__/factories/__tests__/factories.test.ts` exercises every factory exported from `server/__tests__/factories/index.ts`. When adding a new factory, add a matching `describe` block. Before copy-pasting the canonical `it("creates valid defaults") + it("merges overrides")` pattern, check the factory's signature against these known variations — blanket-applying `toMatchObject({ id: 1 })` and `{ id: 99 }` overrides will fail for several existing factories.

**ID shape varies per factory:**

- `createMockUser` — `id: "1"` (string). Override must be `{ id: "99" }`, not `{ id: 99 }`.
- `createMockNutritionData`, `createMockCookedNutrition` — no `id` field at all. Use `name` (or another required field) as the invariant.
- `createMockResolvedFavouriteRecipe` — no `id`, uses `recipeId: 1` instead.
- `createMockChatCompletion` — `id: "chatcmpl-test"` (string) AND a completely different `(content)` signature instead of `(overrides)`. Treat it as a shape test only; substitute by passing different `content` strings and asserting `choices[0].message.content`.

**Date-vs-string fields:**

- Most date fields are real `Date` instances — assert with `toBeInstanceOf(Date)`.
- `createMockResolvedFavouriteRecipe.favouritedAt` is an **ISO string**, not a `Date`. Assert `typeof obj.favouritedAt === "string"` instead.

**Why explicit per-factory describe blocks, not dynamic generation:** The variations above make `describe.each(Object.entries(factories))` awkward — you'd need a config map for special signatures (`createMockChatCompletion`), missing-id factories, and string-vs-number ID overrides. The smoke suite's job is shape verification; the "one describe per factory file" convention is enforced at code-review time, not by runtime introspection.

## Route-Level Auth/Rate-Limit Tests: `vi.doUnmock` Must Be `try/finally`-Wrapped

Route tests mock `../../middleware/auth` and `express-rate-limit` globally at the file level so the default tests get a stubbed authenticated user and a pass-through rate limiter. To assert real 401 / 429 behavior we re-import the route module with the real implementations via `vi.doUnmock(...)` + dynamic `import("...")` + `vi.resetModules()` (see `server/routes/__tests__/recipe-catalog.test.ts`, `recipe-import.test.ts`, `recipe-search.test.ts`, `export.test.ts`).

**Rule:** every `vi.doUnmock("../../middleware/auth")` (or any other globally-mocked module) inside an `it(...)` block must restore the mock in a `finally` clause — not at the end of the test body. If an assertion fails before the restore line runs, the unmock persists in the module registry and the next dynamic import in the same file loads the real module, cascading the failure.

```ts
it("GET ... returns 401 without a bearer token", async () => {
  vi.doUnmock("../../middleware/auth");
  try {
    const { register: registerReal } = await import("../recipe-catalog");
    const app = express();
    app.use(express.json());
    registerReal(app);
    const res = await request(app).get("/api/meal-plan/catalog/search?query=x");
    expect(res.status).toBe(401);
  } finally {
    // Restore even if the assertion failed — otherwise the unmock leaks to
    // later dynamic imports in this file and breaks the 429 / rate-limit test.
    vi.doMock("../../middleware/auth", async () => {
      const actual = await vi.importActual<
        typeof import("../../middleware/__mocks__/auth")
      >("../../middleware/__mocks__/auth");
      return actual;
    });
  }
});
```

For 429 tests, use `vi.doUnmock("express-rate-limit")` in the same `vi.resetModules()` + dynamic-import pattern, but match `windowMs/max` from the actual `_rate-limiters.ts` entry (e.g. `urlImportRateLimit` is `5/min` — fire 6 requests). Don't wrap the 429 test in try/finally — `vi.resetModules()` in the parent `beforeEach` already isolates it from later tests.

## IDOR Assertions: Lock to the Auth-Mock UserId, Not `expect.any(String)`

`expect.objectContaining({ userId: expect.any(String) })` and `toHaveBeenCalledWith(expect.any(String), ...)` pass even if the route handler forwards a hardcoded constant, an attacker-supplied `req.query.userId`, or anything else that happens to be a string. To make the test catch IDOR regressions, assert the exact userId that the auth mock injects.

The default `server/middleware/__mocks__/auth.ts` mock sets `req.userId = "1"` for every request. Use that literal:

```ts
// Not enough — passes even if the handler ignores req.userId:
expect(storage.createMealPlanRecipe).toHaveBeenCalledWith(
  expect.objectContaining({ userId: expect.any(String) }),
  expect.any(Array),
);

// Correct — fails if the handler doesn't propagate the authenticated userId:
expect(storage.createMealPlanRecipe).toHaveBeenCalledWith(
  expect.objectContaining({ userId: "1" }),
  expect.any(Array),
);
expect(storage.findMealPlanRecipeByExternalId).toHaveBeenCalledWith(
  "1",
  "123", // external/route param
);
```

Apply this to **every storage call that performs a userId-scoped read or write** (dedup lookup, create, update, including fire-and-forget background patches). If a test overrides the auth mock with a different userId via `vi.mocked(requireAuth).mockImplementationOnce(...)`, assert against that override value instead.

## Adding New Patterns

When you establish a new pattern:

1. Use it in your implementation
2. Document it here with:
   - What the pattern is
   - When to use it
   - When NOT to use it
   - Code example
3. Reference this doc in your todo/PR
