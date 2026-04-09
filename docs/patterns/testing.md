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

## Adding New Patterns

When you establish a new pattern:

1. Use it in your implementation
2. Document it here with:
   - What the pattern is
   - When to use it
   - When NOT to use it
   - Code example
3. Reference this doc in your todo/PR
