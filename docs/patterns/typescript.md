# TypeScript Patterns

### Shared Types Location

Place types used by both client and server in `shared/types/`:

```
shared/
  types/
    auth.ts      # Authentication types
    user.ts      # User-related types
    api.ts       # API request/response types
```

### Type Guards for Runtime Validation

Use type guards when validating data from external sources (API responses, JWT payloads, storage):

```typescript
// Define the expected shape
export interface AccessTokenPayload {
  sub: string;
}

// Create a type guard
export function isAccessTokenPayload(
  payload: unknown,
): payload is AccessTokenPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as AccessTokenPayload).sub === "string"
  );
}

// Usage
const payload = jwt.verify(token, secret);
if (!isAccessTokenPayload(payload)) {
  throw new Error("Invalid payload");
}
// payload is now typed as AccessTokenPayload
```

### Type Guard for Enum Validation

When validating against a defined set of values (like subscription tiers), use a type guard that checks the source of truth:

```typescript
// Source of truth: array of valid values
export const subscriptionTiers = ["free", "premium"] as const;
export type SubscriptionTier = (typeof subscriptionTiers)[number];

// Type guard validates against the array
function isValidSubscriptionTier(tier: string): tier is SubscriptionTier {
  return (subscriptionTiers as readonly string[]).includes(tier);
}

// Usage: Safe validation with fallback
const tierValue = user.subscriptionTier || "free";
const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";

// Now tier is properly typed as SubscriptionTier
const features = TIER_FEATURES[tier];
```

**Why:** Validates against the actual source of truth, not a duplicated list. If you add a new tier to `subscriptionTiers`, the type guard automatically accepts it.

**Colocation rule:** Define the type guard in the same file as the source array it validates. `isValidSubscriptionTier()` lives in `shared/types/premium.ts` next to `subscriptionTiers` — not in a consumer like `routes.ts` or `storage.ts`. This prevents duplication and ensures all consumers import from one canonical location.

**When to use:** Validating enum-like values from database, API responses, or user input against a defined set.

### Union Types for Record Keys

Replace `Record<string, T>` with `Record<UnionType, T>` for compile-time safety:

```typescript
// Good: Compile-time typo prevention
type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "athlete";
type PrimaryGoal =
  | "lose_weight"
  | "gain_muscle"
  | "maintain"
  | "eat_healthier"
  | "manage_condition";

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  athlete: 1.9,
};

// TypeScript error: "sedantary" is not assignable to type "ActivityLevel"
const multiplier = ACTIVITY_MULTIPLIERS["sedantary"]; // Typo caught!
```

```typescript
// Bad: No compile-time protection
const ACTIVITY_MULTIPLIERS: Record<string, number> = { ... };

// No error - runtime undefined
const multiplier = ACTIVITY_MULTIPLIERS["sedantary"];
```

**Why:** Catches typos at compile time, enables autocomplete, removes need for defensive fallbacks.

**When to use:** Any constant object with a fixed set of keys (config maps, feature flags, tier definitions).

### Zod safeParse with Fallback for Database Values

When reading enum or constrained values from database/storage, use `safeParse()` with a fallback instead of unsafe type assertions:

```typescript
import { z } from "zod";

// Define the schema for valid values
const subscriptionTierSchema = z.enum(["free", "premium", "enterprise"]);
type SubscriptionTier = z.infer<typeof subscriptionTierSchema>;

// Good: Safe parsing with fallback
function getSubscriptionTier(dbValue: unknown): SubscriptionTier {
  const result = subscriptionTierSchema.safeParse(dbValue);
  return result.success ? result.data : "free";
}

// Usage in storage layer
async getUser(id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) return null;

  return {
    ...row,
    subscriptionTier: getSubscriptionTier(row.subscriptionTier),
  };
}
```

```typescript
// Bad: Unsafe type assertion
async getUser(id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!row) return null;

  return {
    ...row,
    // DANGER: If database has invalid value (e.g., "premium_trial"),
    // TypeScript thinks it's valid but runtime behavior is undefined
    subscriptionTier: row.subscriptionTier as SubscriptionTier,
  };
}
```

**Why:** Database values can become invalid due to:

- Schema migrations leaving stale data
- Direct database edits bypassing application logic
- Enum values being removed from code but not cleaned from database

**When to use:**

- Reading enum fields from database
- Parsing stored JSON with expected structure
- Any database field with constrained values (status, role, tier, type)

**Fallback strategy:**

- Use the most restrictive/safe default (e.g., "free" tier, "pending" status)
- Consider logging unexpected values for monitoring
- The application continues working even with corrupted data

### Zod safeParse at Internal Type-Erasure Boundaries

When a callback or handler receives data through an intentionally untyped channel (e.g., `Record<string, unknown>`, event payloads, message-passing interfaces), validate with `safeParse()` instead of casting with `as`. This differs from the database/external API patterns because the data originates from trusted internal code — but the untyped channel erases the structural guarantee.

```typescript
// The block renderer emits actions through an untyped channel
type BlockActionHandler = (action: Record<string, unknown>) => void;

// Bad: Array.isArray proves "it's an array" but NOT "it's an array of MealPlanDay"
const planDays = Array.isArray(action.plan)
  ? (action.plan as MealPlanDay[])
  : undefined;

// Good: safeParse re-establishes the full structural guarantee
import { mealPlanCardSchema } from "@shared/schemas/coach-blocks";

const parsed = mealPlanCardSchema.shape.days.safeParse(action.plan);
const planDays = parsed.success ? parsed.data : undefined;
```

**Why internal data needs validation too:** The `Record<string, unknown>` signature is a deliberate type-erasure boundary. Even if the emitter (e.g., `MealPlanCard`) sends Zod-validated data today, the untyped channel means any future caller can pass anything. `safeParse` at the receiving end restores the type contract.

**When to use:**

- Callbacks typed as `Record<string, unknown>` or `unknown`
- Event bus / message-passing handlers
- Any internal interface where structured data crosses through an untyped channel

**When NOT to use:**

- Internal function calls with fully typed signatures — the compiler already enforces the contract

**References:**

- `client/components/coach/coach-chat-utils.ts` — `parsePlanDays()` validates action payload
- `client/components/coach/CoachChat.tsx` — `handleBlockAction` consumes block actions

### Zod Discriminated Union for Response Schemas

When an API response has two distinct shapes (success vs error), use `z.discriminatedUnion()` to define both paths with a shared discriminant field. This gives both server and client compile-time safety over the response shape:

```typescript
// shared/schemas/subscription.ts
export const UpgradeResponseSchema = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    tier: subscriptionTierSchema, // Reuse domain schema, not z.string()
    expiresAt: z.string().nullable(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
  }),
]);

export type UpgradeResponse = z.infer<typeof UpgradeResponseSchema>;
```

```typescript
// Server: TypeScript narrows based on the discriminant
const response: UpgradeResponse = validation.valid
  ? { success: true, tier: "premium", expiresAt: expiry.toISOString() }
  : { success: false, error: "Invalid receipt", code: validation.errorCode };

// Client: Safe narrowing
const result = UpgradeResponseSchema.parse(data);
if (result.success) {
  // result.tier is typed as SubscriptionTier
  // result.expiresAt is typed as string | null
} else {
  // result.error is typed as string
  // result.code is typed as string | undefined
}
```

```typescript
// Bad: Loose object with optional fields
const ResponseSchema = z.object({
  success: z.boolean(),
  tier: z.string().optional(),
  expiresAt: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
});
// Client must manually check which fields exist — no compile-time narrowing
```

**Key rules:**

- Use a domain-specific Zod schema for constrained fields (e.g., `subscriptionTierSchema` not `z.string()`)
- Make the discriminant field the first field for readability
- Use `z.literal()` for the discriminant values
- Place in `shared/schemas/` so both server and client share the same type

**When to use:** Any API endpoint with distinctly different success and error response shapes (upgrades, payments, imports, multi-step workflows).

**When NOT to use:** Simple endpoints where success returns data and error returns `{ error: string }` (use the standard API error structure instead).

### Discriminated Union State with Named Predicates

When a hook or component tracks an async flow with multiple states (loading, error, success, cancelled, etc.), model the state as a TypeScript discriminated union keyed on `status`. Attach extra data only to the variants that need it, then write named predicate functions for each logical grouping of states:

```typescript
// shared/types/subscription.ts — define the state union
export type PurchaseState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pending" }
  | { status: "success" }
  | { status: "cancelled" }
  | { status: "restoring" }
  | { status: "error"; error: PurchaseError };

// client/lib/subscription/type-guards.ts — named predicates
export function isPurchaseInProgress(state: PurchaseState): boolean {
  return (
    state.status === "loading" ||
    state.status === "pending" ||
    state.status === "restoring"
  );
}

export function canInitiatePurchase(state: PurchaseState): boolean {
  return (
    state.status === "idle" ||
    state.status === "cancelled" ||
    state.status === "error"
  );
}
```

```typescript
// Hook uses predicates as guards before state transitions
const purchase = useCallback(async () => {
  if (!canInitiatePurchase(state)) return;  // guard
  safeSetState({ status: "loading" });
  // ... async flow
}, [state]);

// Component uses predicates for UI logic
const inProgress = isPurchaseInProgress(state);
<Pressable disabled={inProgress}>
```

```typescript
// Bad: Inline status checks scattered across files
if (
  state.status === "loading" ||
  state.status === "pending" ||
  state.status === "restoring"
) {
  // duplicated in 3 places with risk of drift
}
```

**Key elements:**

1. **Union, not enum + separate data**: Each variant carries only the fields it needs (e.g., only `error` has the `error` field). TypeScript narrows automatically after `status` checks.
2. **Named predicates, not inline checks**: Group related statuses into named functions (`canInitiatePurchase`, `isPurchaseInProgress`). This centralizes the logic and prevents drift when new statuses are added.
3. **Predicates are pure**: They live in their own file (e.g., `type-guards.ts`), take the union as input, and are trivially testable.
4. **Predicates used for both guards and UI**: The same predicate drives transition guards in hooks and disabled/loading states in components.

**When to use:** Any async multi-step flow with 4+ states where different parts of the codebase need to check "can I start?" vs "is it in progress?" vs "is it done?" (purchases, uploads, onboarding wizards, multi-step forms).

**When NOT to use:** Simple boolean loading/error states where `useState<boolean>` or TanStack Query's built-in `isLoading`/`isError` suffice.

**Reference:** `shared/types/subscription.ts`, `client/lib/subscription/type-guards.ts`, `client/lib/iap/usePurchase.ts`

### Extend Express Types Properly

When adding properties to Express Request:

```typescript
// In the file where you need it (not a global .d.ts)
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}
```

**Middleware type narrowing convention:** `Request.userId` is declared as non-optional (`string`) because every route that accesses it sits behind `requireAuth` middleware, which guarantees assignment. The `AuthenticatedRequest` type alias (exported from `server/middleware/auth.ts`) is a semantic marker in handler signatures — it signals "this handler requires auth" but is structurally identical to `Request`. Non-authenticated routes (login, register) use plain `Request` and never read `req.userId`.

### Inline Response Types

Define API response types inline where they're consumed, not in shared files:

```typescript
// Good: Type defined where used (client/screens/HistoryScreen.tsx)
type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  calories?: string | null;
  imageUrl?: string | null;
  scannedAt: string; // Dates come as strings over JSON
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};

const { data } = useInfiniteQuery<PaginatedResponse>({
  queryKey: ["api", "scanned-items"],
  // ...
});
```

```typescript
// Bad: Shared types in separate file
// shared/types/models.ts
export interface ScannedItemResponse { ... }

// Multiple import locations become tightly coupled
import { ScannedItemResponse } from '@shared/types/models';
```

**When to use shared types:**

- Auth types (User, AuthResponse) - used in multiple places
- Database schema types - shared by ORM
- API response types used by 3+ screens with identical shape (see below)

**When NOT to use shared types:**

- API response shapes used by only 1-2 components
- One-off request/response types

### Shared Client API Types (Exception Pattern)

When the same API response shape is used by multiple screens (3+), create a shared types file to eliminate duplication:

```typescript
// client/types/api.ts - Good: Single source of truth for widely-used types
export type ScannedItemResponse = {
  id: number;
  productName: string;
  brandName?: string | null;
  calories?: string | null;
  protein?: string | null;
  carbs?: string | null;
  fat?: string | null;
  imageUrl?: string | null;
  scannedAt: string;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
};

export type DailySummaryResponse = {
  totalCalories: number;
  itemCount: number;
};
```

```typescript
// Usage in multiple screens
import type { ScannedItemResponse, PaginatedResponse } from "@/types/api";

// HistoryScreen.tsx
const { data } = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({...});

// ItemDetailScreen.tsx
const { data } = useQuery<ScannedItemResponse>({...});
```

**When to use:**

- Same type used in 3+ components
- Type represents a core domain entity (ScannedItem, User, DailySummary)
- Changes to the API shape should update all consumers

**Why generic `PaginatedResponse<T>`:** Enables reuse across different paginated endpoints while maintaining type safety.

### Prop Shielding in Wrapper Components

When a wrapper component remaps a prop from the underlying primitive (e.g. `maxScale` → `maxFontSizeMultiplier`), destructure the raw prop out of `...rest` to prevent callers from bypassing the wrapper's API:

```typescript
// ❌ BAD — rest spread silently overwrites the explicit prop
export function ThemedText({ maxScale, ...rest }: ThemedTextProps) {
  return <Text maxFontSizeMultiplier={maxScale} {...rest} />;
  //     If rest contains maxFontSizeMultiplier, it wins (spread is left-to-right)
}

// ✅ GOOD — strip the raw prop so the wrapper always controls it
export function ThemedText({
  maxScale,
  maxFontSizeMultiplier: _ignored,
  ...rest
}: ThemedTextProps) {
  return <Text maxFontSizeMultiplier={maxScale} {...rest} />;
}
```

**Why:** JSX compiles to `{ maxFontSizeMultiplier: maxScale, ...rest }`. Object spread is left-to-right, so later keys overwrite earlier ones. Without the destructure, a caller passing both `maxScale` and `maxFontSizeMultiplier` (or just the raw prop from old code) gets silent, unpredictable behavior.

**When to apply:** Any component that wraps a React Native primitive and remaps, restricts, or transforms a prop before passing it through.
