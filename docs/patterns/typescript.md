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

**Same-name computed transform variant:** When the source prop and target prop share the same name (e.g., computing a derived `accessibilityHint` from the caller's `accessibilityHint`), the same rule applies — destructure the prop normally to remove it from the rest spread:

```typescript
// ❌ BAD — props.accessibilityHint is still in {...props}, overriding the computed value
export function TextInput({ error, errorMessage, ...props }: TextInputProps) {
  return (
    <RNTextInput
      accessibilityHint={error ? `${props.accessibilityHint}. ${errorMessage}` : props.accessibilityHint}
      {...props}  // accessibilityHint from here silently wins (same key, comes last)
    />
  );
}

// ✅ GOOD — destructure to remove from spread
export function TextInput({ error, errorMessage, accessibilityHint, ...props }: TextInputProps) {
  return (
    <RNTextInput
      accessibilityHint={error ? `${accessibilityHint}. ${errorMessage}` : accessibilityHint}
      {...props}  // accessibilityHint is gone from props — no override
    />
  );
}
```

### Unified Source Normalization

When multiple data sources (different DB tables, external APIs) need to be rendered in a single list, normalize them into a shared type with a `source` discriminator and a prefixed composite ID. This avoids tagged unions and source-specific rendering branches.

```typescript
// shared/types/recipe-search.ts
export interface SearchableRecipe {
  id: string; // "personal:42", "community:17", "spoonacular:654321"
  source: "personal" | "community" | "spoonacular";
  title: string;
  // ... common fields from all sources (nullable where a source lacks the data)
}
```

```typescript
// Normalizers — one per source, flatten into the common type
function mealPlanToSearchable(
  recipe: MealPlanRecipe,
  ingredientNames: string[],
): SearchableRecipe {
  return {
    id: `personal:${recipe.id}`,
    source: "personal",
    title: recipe.title,
    cuisine: recipe.cuisine ?? null, // present in this source
    caloriesPerServing: parseNum(recipe.caloriesPerServing),
    // ...
  };
}

function communityToSearchable(recipe: CommunityRecipe): SearchableRecipe {
  return {
    id: `community:${recipe.id}`,
    source: "community",
    title: recipe.title,
    cuisine: null, // not present in this source
    caloriesPerServing: null,
    // ...
  };
}
```

```typescript
// Client — one render path, extract numeric ID when needed
const numericId = parseInt(item.id.split(":")[1], 10);
const recipeType = item.source === "personal" ? "mealPlan" : item.source;
```

**Key rules:**

- **Composite ID format:** `"source:numericId"` — globally unique, parseable, works as React key
- **Nullable fields:** Use `null` (not `undefined`) for fields a source doesn't provide — keeps the interface honest
- **One normalizer per source:** Each normalizer maps source-specific shapes to the common interface, isolating source-specific logic
- **Shared type in `shared/types/`:** Both client and server import from the same file

**When to use:** Merging results from 2+ heterogeneous sources into a single list (search results, activity feeds, notification streams).

**When NOT to use:** Sources already share the same DB table/type, or when only one source is rendered at a time (use separate components instead).

**Reference:** `shared/types/recipe-search.ts`, `server/services/recipe-search.ts` (normalizers), `client/screens/meal-plan/RecipeBrowserScreen.tsx` (unified rendering)

### Generic Utilities That Preserve Caller-Side Type Narrowing

When a utility function only reads a base-type's properties but doesn't
add new ones, making it generic lets callers with narrower unions pass
their arrays directly and receive the same narrowed type back. Without
the generic, call sites must widen to the base type going in, then
re-narrow coming out — type-casting noise that obscures the real data
shape and creates a latent correctness hazard if the narrowing is wrong.

```typescript
// ❌ Without generic: call site needs two .map() casts
interface HistoryMessage { role: "user" | "assistant" | "system" | "tool"; content: string; }

function truncateHistory(messages: HistoryMessage[]): HistoryMessage[] { ... }

// Caller's array is { role: "user" | "assistant" | "system" } — no "tool"
// Must widen in, then re-narrow back out:
messageHistory = truncateHistory(
  messageHistory.map((m) => ({ role: m.role as HistoryMessage["role"], content: m.content })),
).map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content }));
```

```typescript
// ✅ With generic: caller passes array directly, gets narrowed type back
function truncateHistory<T extends HistoryMessage>(messages: T[]): T[] { ... }

// No casting needed — T is inferred as the caller's narrower type:
messageHistory = truncateHistory(messageHistory);
```

**When to apply:**

- The function filters, sorts, or reorders items without changing their
  type (e.g. `truncateHistoryToBudget`, pagination slicers)
- Callers use a union that is a strict subset of the base type's union
- The function body only needs to read the base-type properties (use
  `m.role === "tool"` against the base, not against `T`)

**When NOT to apply:**

- The function maps items to a different shape (return type differs from
  input type — generics won't help here)
- All callers use the exact base type anyway (the generic buys nothing)

**Reference:** `server/lib/chat-history-truncate.ts` —
`truncateHistoryToBudget<T extends HistoryMessage>` lets
`coach-pro-chat.ts` pass its `{ role: "user" | "assistant" | "system" }[]`
directly without casting.

**Origin:** 2026-04-28 code review — the initial implementation used a
double `.map()` to satisfy the `HistoryMessage` type, which would have
silently corrupted `"tool"` roles if message storage were ever extended.

### `satisfies z.ZodType<T>` for Schema/Type Drift Prevention

When creating a Zod schema that mirrors a TypeScript type (especially a discriminated union), add `satisfies z.ZodType<T>` to the schema definition. This makes TypeScript verify at compile time that the schema fully covers the type — if a new variant is added to the TypeScript union but not to the Zod schema, the file fails to compile.

```typescript
// shared/types/reminders.ts — the source of truth
export type CoachContextItem =
  | { type: "meal-log"; lastLoggedAt: string | null }
  | { type: "commitment"; notebookEntryId: number; content: string }
  | { type: "daily-checkin"; calories: number }
  | { type: "user-set"; message: string };

// shared/schemas/reminders.ts — Zod schema with compile-time drift guard
export const coachContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("meal-log"),
    lastLoggedAt: z.string().nullable(),
  }),
  z.object({
    type: z.literal("commitment"),
    notebookEntryId: z.number(),
    content: z.string(),
  }),
  z.object({ type: z.literal("daily-checkin"), calories: z.number() }),
  z.object({ type: z.literal("user-set"), message: z.string() }),
]) satisfies z.ZodType<CoachContextItem>;
//  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//  TypeScript error here if schema doesn't cover every variant of CoachContextItem
```

```typescript
// Bad: Schema can silently diverge from the TypeScript type
export const coachContextItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("meal-log"),
    lastLoggedAt: z.string().nullable(),
  }),
  // forgot "commitment", "daily-checkin", "user-set" — no compile error
]);
```

**Why:** Zod schemas for JSONB/storage validation are easy to forget when a type evolves. The `satisfies` constraint turns a runtime surprise into a compile-time error at the schema definition site — not at the call site hours later.

**When to use:**

- Any Zod schema that mirrors a TypeScript type in `shared/types/`
- Especially discriminated unions where missing a variant is a common mistake
- Schemas co-located with (or referencing) a TypeScript type that will grow over time

**When NOT to use:**

- Schemas that intentionally accept a _subset_ of a type (e.g., partial validation for user input)
- Schemas that are a superset of a type (they already satisfy it)

**Pairing:** Always use `z.discriminatedUnion()` (not `z.union()`) for discriminated types — it validates the `type` key first and gives cleaner error messages.

**Reference:** `shared/schemas/reminders.ts` — `coachContextItemSchema satisfies z.ZodType<CoachContextItem>`

---

### `Equals<A, B>` for Bidirectional Schema/Type Alignment

When `satisfies z.ZodType<T>` is too permissive — it only checks that the schema is _at least_ as strict as the type, not that they're equivalent — use a higher-kinded `Equals<>` conditional to assert mutual assignability. Use this when you want both directions enforced: schema can't be wider than the type and the type can't be wider than the schema.

```typescript
// shared/schemas/taste-picks.ts
import { z } from "zod";
import type { RecipeCandidate } from "../types/taste-picks";

export const recipeCandidateSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  imageUrl: z.string(),
  cuisineOrigin: z.string().nullish(),
});

// Higher-kinded conditional that only resolves to `true` when A and B are
// mutually assignable. Asymmetric drift in either direction fails to compile.
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const _recipeCandidateAligned: Equals<
  RecipeCandidate,
  z.infer<typeof recipeCandidateSchema>
> = true;

// Suppress unused-variable warning — assertion is for tsc only.
void _recipeCandidateAligned;
```

**Why:** `satisfies z.ZodType<T>` succeeds when the schema is a _superset_ of the type (extra fields, looser nullability). `Equals<>` rejects supersets too. This matters for response validation schemas: a hand-written `RecipeCandidate` interface and a Zod `recipeCandidateSchema` that drift apart in either direction can silently mask bugs (server returns extra fields the type doesn't have; type evolves but schema doesn't).

**When to use:**

- API response schemas paired with a hand-written interface in `shared/types/`
- Any place you'd want a compile failure on _any_ shape drift, not just missing variants
- Adjacent to `Equals<>` definitions, pin one assertion per related (type, schema) pair

**When NOT to use:**

- Schemas that intentionally accept a subset (use `satisfies` or no guard)
- Schemas that intentionally accept a superset for forward-compat (use neither)

**Reference:** `shared/schemas/taste-picks.ts` — `Equals<RecipeCandidate, z.infer<typeof recipeCandidateSchema>>` lines for each (type, schema) pair.

---

### Zod `.nullish()` vs `.nullable()` for Resilient API Response Schemas

When validating API responses on the client, prefer `.nullish()` (= `.nullable().optional()`) over `.nullable()` for fields that the server emits as `null`. The reason isn't about the happy path — it's about JSON-serialization edge cases. `JSON.stringify` drops `undefined` fields silently. If any server code path constructs the payload via `{ ...row }` where the column is `undefined` (e.g., a row that was selected without the column), the field disappears from the wire entirely — and `.nullable()` rejects the missing field, flipping the client into an error state on otherwise-valid data.

```typescript
// Defensive — accepts string | null | undefined | missing
cuisineOrigin: z.string().nullish(),

// Strict — accepts string | null only; rejects missing field
cuisineOrigin: z.string().nullable(),
```

Pair `.nullish()` with optional property syntax in the matching TS interface:

```typescript
export interface RecipeCandidate {
  id: number;
  title: string;
  imageUrl: string;
  cuisineOrigin?: string | null; // `?:` matches `z.string().nullish()`
}
```

Without the `?:`, the `Equals<>` guard (above) will fail because Zod infers `nullish()` as an optional property.

**Why:** Defense-in-depth for runtime validators. The point of a runtime schema is shape resilience — keeping it permissive at known-safe boundaries (a column that's already nullable in the DB) costs nothing and prevents a class of "server change drops field, client breaks" bugs.

**When to use:**

- Response-validator schemas (client `safeParse`-ing server replies)
- Any field whose underlying source is nullable in the DB
- Optional fields where omission and `null` are semantically equivalent

**When NOT to use:**

- Request body schemas (be strict on input; reject unexpected omissions)
- Schemas where `undefined` and `null` mean different things

**Reference:** `shared/schemas/taste-picks.ts` — `cuisineOrigin: z.string().nullish()` paired with `RecipeCandidate.cuisineOrigin?: string | null`.

---

### `Object.freeze` + Per-Call Spread for Hoisted Constants Passed to Mutable-Typed SDKs

When hoisting an expensive-to-build array (e.g., an OpenAI tool-definition list) from per-request construction to a module-level constant, the array becomes _shared mutable state_ across requests. Defend with `Object.freeze` so accidental top-level mutation throws loudly. But many third-party SDKs type their input parameters as mutable arrays (`T[]`, not `readonly T[]`), so passing a frozen array fails type-checking. Resolve by spreading at the call site — a shallow O(n) copy over references, still vastly cheaper than rebuilding the whole array per request.

```typescript
// server/services/nutrition-coach.ts

// Module load: build once, freeze the top-level array.
const TOOL_DEFINITIONS = Object.freeze(getToolDefinitions());

export async function* generateCoachProResponse(/* ... */) {
  // Per call: shallow-spread to a fresh mutable array the SDK accepts.
  // O(n) over references; the nested tool objects are reused.
  const tools = [...TOOL_DEFINITIONS];
  yield* openai.chat.completions.create({ /* ... */, tools });
}
```

**Why:** Hoisting alone trades per-request allocation for shared mutable state. If a future caller does `tools.push(extraTool)`, the mutation leaks across requests silently. `Object.freeze` makes that mutation throw. The spread workaround is needed because OpenAI's SDK (and many others) types the `tools` field as `ChatCompletionTool[]` (mutable), and a `readonly ChatCompletionTool[]` is not assignable to it.

**When to use:**

- Module-level constants built once but consumed per-request
- Especially when the value is passed to an external SDK with mutable parameter types
- Any hoisted array/object referenced from concurrent code paths

**When NOT to use:**

- Local arrays scoped to a single call — no shared state, no defense needed
- SDKs that accept `readonly T[]` (or `ReadonlyArray<T>`) — pass the frozen value directly

**Reference:** `server/services/nutrition-coach.ts` — `Object.freeze(getToolDefinitions())` + `const tools = [...TOOL_DEFINITIONS]`.

---

## `??` vs `||` for Optional Numeric Parameters

**Rule:** Use `??` (nullish coalescing), not `||` (logical OR), when falling back from an optional `number` parameter to a default.

```typescript
// WRONG — hour=0 (midnight) is falsy, so || silently falls back to server time
const hour = userHour || new Date().getHours();

// CORRECT — ?? only falls back for null/undefined, not for 0
const hour = userHour ?? new Date().getHours();
```

**Why it matters:** `0` is a common valid numeric value (midnight for an hour range, page 0 for pagination, index 0 for list positions). Using `||` treats it as "not provided" and falls back silently — no type error, no runtime error, just wrong behavior.

**When to use:** Any time the signature is `param?: number` and the fallback is `someDefault()` or a constant.

**When NOT to use:** If `0` genuinely means "not set" in your domain (rare — prefer `undefined` for that instead).

**Origin:** `server/services/carousel-builder.ts` — `userHour?: number` where `0` = midnight; caught during PR #104 review.

## Line-Anchored Heading Matching in Markdown Manipulation

**Rule:** When inserting or replacing content relative to a markdown heading
(`## Foo`), NEVER use `String.prototype.indexOf("## Foo")`. It matches anywhere
in the string, including mid-sentence prose. Use a line-anchored matcher
instead.

```typescript
// ❌ WRONG — matches "see ## Risks above" inside body prose
const idx = content.indexOf("## Risks");
return `${content.slice(0, idx)}<inserted>${content.slice(idx)}`;

// ✅ CORRECT — only matches a real heading line
function findHeadingOffset(content: string, heading: string): number {
  if (content.startsWith(`${heading}\n`)) return 0;
  const needle = `\n${heading}\n`;
  const newlineIdx = content.indexOf(needle);
  return newlineIdx === -1 ? -1 : newlineIdx + 1;
}
```

**Why:** Markdown sources frequently quote their own structure as prose
("see ## Risks above", "the ## Updates section was..."). A naive `indexOf`
match on those mentions will split the line in half on insertion, silently
corrupting the file. The line-anchored form requires the heading to be
preceded by start-of-file OR newline AND followed by newline — so prose
mentions can't trigger it.

**When to use:** Any time you're programmatically inserting, replacing, or
slicing markdown content based on heading position. Apply the same rule to
`^## Foo$` regex matching: use the `m` (multiline) flag so `^`/`$` mean
line-start/line-end, not string-start/string-end.

**When NOT to use:** If you're matching INLINE markdown markers (e.g.,
`**bold**`, `` `code` ``), the line-anchored approach doesn't apply —
those genuinely can appear anywhere on a line.

**Pair with:** A test that constructs a fixture with the heading mentioned
in body prose AND as a real heading, then asserts the function only fires
on the real heading. See `scripts/__tests__/delegate-copilot-issue.test.ts`
→ `ignores mid-sentence anchor mentions in body text`.

**Origin:** `scripts/delegate-copilot-issue.ts` `writeProjectRulesSectionToTodo`;
caught during PR #149 Task 6 review (commit `fe1d720b`).

## Stable Identifier Keys for Bypass / Exemption Sets

**Rule:** If you have a set of "exempt" or "bypassed" items keyed off
human-readable strings (display messages, reason text), and the items can be
edited, the bypass silently breaks the next time someone edits the wording.
Use a stable enum / union key and look up via that key, not the display
text.

```typescript
// ❌ WRONG — couples bypass to mutable prose
const BLOCKED_REASONS: [RegExp, string][] = [
  [/\bauth\b/, "JWT/auth work is not eligible for Copilot delegation"],
];
const TEST_BYPASSABLE_REASONS = new Set([
  "JWT/auth work is not eligible for Copilot delegation",
]);
// If anyone tweaks the reason string in BLOCKED_REASONS, the Set lookup
// silently misses and the bypass stops working — with no type error.

// ✅ CORRECT — stable union key, display text lives in a lookup table
type BlockKey = "JWT_AUTH" | "IAP_RECEIPT" | "SECRETS" | "HEALTH_DATA";

const BLOCK_REASONS: Record<BlockKey, string> = {
  JWT_AUTH: "JWT/auth work is not eligible for Copilot delegation",
  IAP_RECEIPT: "IAP receipt validation is not eligible for Copilot delegation",
  SECRETS: "secrets handling is not eligible for Copilot delegation",
  HEALTH_DATA:
    "health-data boundary work is not eligible for Copilot delegation",
};

const BLOCKED_PATTERNS: [RegExp, BlockKey][] = [[/\bauth\b/, "JWT_AUTH"]];

const TEST_BYPASSABLE_KEYS = new Set<BlockKey>(["JWT_AUTH", "IAP_RECEIPT"]);
// Editing display text in BLOCK_REASONS no longer affects bypass logic.
// The union type prevents typos at the call site.
```

**Why:** Display strings change for non-functional reasons (clarification,
i18n, punctuation). The compiler can't tell you a mutated string broke a
sibling Set lookup, so the bypass silently degrades — exactly the kind of
bug code review struggles to catch.

**When to use:** Any time two pieces of code agree on "the same item" via a
string identifier. Promote the identifier to a typed constant. Examples:
exemption sets, dispatch tables, switch/case discriminators sourced from
external strings.

**Origin:** `scripts/delegate-copilot-issue.ts` `BLOCKED_PATTERNS` /
`TEST_BYPASSABLE_KEYS`; surfaced as WARNING during PR #149 kimi-review and
refactored in commit `93c6a606`.
