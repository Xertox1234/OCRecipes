# Development Patterns

This document captures established patterns for the NutriScan codebase. Follow these patterns for consistency across features.

## Table of Contents

- [Security Patterns](#security-patterns)
  - [SSRF Protection for Server-Side URL Fetching](#ssrf-protection-for-server-side-url-fetching)
- [TypeScript Patterns](#typescript-patterns)
  - [Zod Discriminated Union for Response Schemas](#zod-discriminated-union-for-response-schemas)
  - [Discriminated Union State with Named Predicates](#discriminated-union-state-with-named-predicates)
  - [Shared Client API Types](#shared-client-api-types-exception-pattern)
- [API Patterns](#api-patterns)
  - [Stub Service with Production Safety Gate](#stub-service-with-production-safety-gate)
  - [Tier-Gated Route Guards](#tier-gated-route-guards)
  - [checkPremiumFeature Helper for Tier Gates](#checkpremiumfeature-helper-for-tier-gates)
  - [Atomic Server Endpoints Over Multi-Request Flows](#atomic-server-endpoints-over-multi-request-flows)
- [External API Patterns](#external-api-patterns)
  - [External Resource Dedup on Save](#external-resource-dedup-on-save)
  - [Multi-Source Nutrition Lookup Chain](#multi-source-nutrition-lookup-chain)
  - [Barcode Padding Normalization](#barcode-padding-normalization)
  - [Cross-Validation Between Data Sources](#cross-validation-between-data-sources)
  - [Graceful 404 Handling with Raw Fetch](#graceful-404-handling-with-raw-fetch)
  - [Fetch Timeout with AbortSignal for External APIs](#fetch-timeout-with-abortsignal-for-external-apis)
  - [Zod safeParse for External API Responses](#zod-safeparse-for-external-api-responses)
- [Database Patterns](#database-patterns)
  - [`text()` Over `pgEnum` for Enum-Like Columns](#text-over-pgenum-for-enum-like-columns)
  - [Cache-First Pattern for Expensive Operations](#cache-first-pattern-for-expensive-operations)
  - [Fire-and-Forget for Non-Critical Background Operations](#fire-and-forget-for-non-critical-background-operations)
  - [Content Hash Invalidation Pattern](#content-hash-invalidation-pattern)
  - [Parent-Child Cache with Cascade Delete](#parent-child-cache-with-cascade-delete)
  - [LEFT JOIN with COALESCE for Nullable Foreign Keys](#left-join-with-coalesce-for-nullable-foreign-keys)
  - [Pre-Fetched IDs to Avoid Redundant Queries](#pre-fetched-ids-to-avoid-redundant-queries)
- [Client State Patterns](#client-state-patterns)
  - [Business Logic Errors in Mutations](#business-logic-errors-in-mutations)
  - [Typed ApiError Class for Client-Side Error Differentiation](#typed-apierror-class-for-client-side-error-differentiation)
  - [useQuery Over useState+useEffect for Server Data](#usequery-over-usestateuseeffect-for-server-data)
  - [`enabled` Parameter for Premium-Gated Queries](#enabled-parameter-for-premium-gated-queries)
- [React Native Patterns](#react-native-patterns)
  - [Multi-Select Checkbox Pattern](#multi-select-checkbox-pattern)
  - [Premium Feature Gating UI](#premium-feature-gating-ui)
  - [Intentional useEffect Dependencies](#intentional-useeffect-dependencies)
  - [Route Params for Mode Toggling](#route-params-for-mode-toggling)
  - [CompositeNavigationProp for Cross-Stack Navigation](#compositenavigationprop-for-cross-stack-navigation)
  - [Full-Screen Detail with transparentModal](#full-screen-detail-with-transparentmodal)
  - [fullScreenModal Exception for Camera](#fullscreenmodal-exception-for-camera)
  - [FAB Overlay with Tab Bar Clearance](#fab-overlay-with-tab-bar-clearance)
  - [Coordinated Pull-to-Refresh](#coordinated-pull-to-refresh-for-multiple-queries)
  - [Accessibility Props Pattern](#accessibility-props-pattern)
  - [Touch Target Size Pattern](#touch-target-size-pattern)
  - [Accessibility Grouping Pattern](#accessibility-grouping-pattern)
  - [Dynamic Accessibility Announcements](#dynamic-accessibility-announcements)
  - [useAccessibility Hook Pattern](#useaccessibility-hook-pattern)
  - [Accessibility-Aware Haptics Pattern](#accessibility-aware-haptics-pattern)
  - [Reduced Motion Animation Pattern](#reduced-motion-animation-pattern)
  - [Skeleton Loader Pattern](#skeleton-loader-pattern)
  - [Dynamic Loading State Labels](#dynamic-loading-state-labels)
  - [Query Error Retry Pattern](#query-error-retry-pattern)
  - [Bottom-Sheet Lifecycle State Machine](#bottom-sheet-lifecycle-state-machine)
  - [Keyboard-to-Sheet Sequencing](#keyboard-to-sheet-sequencing)
  - [Lazy Modal Mounting](#lazy-modal-mounting)
  - [Module-Level Key Counters for Dynamic Lists](#module-level-key-counters-for-dynamic-lists)
  - [Unsaved Changes Navigation Guard](#unsaved-changes-navigation-guard)
  - [Form State Hook with Summaries and isDirty](#form-state-hook-with-summaries-and-isdirty)
  - [Auto-Dismiss Snackbar with useRef Timer](#auto-dismiss-snackbar-with-useref-timer)
- [External API Parsing Patterns](#external-api-parsing-patterns)
  - [ISO 8601 Duration Parsing](#iso-8601-duration-parsing)
  - [Intent-Driven Config Object](#intent-driven-config-object)
  - [Compress-Upload-Cleanup for Image Uploads](#compress-upload-cleanup-for-image-uploads)
  - [Confidence-Based Follow-Up Refinement](#confidence-based-follow-up-refinement)
  - [Zod Union + Transform for LLM Output Flexibility](#zod-union--transform-for-llm-output-flexibility)
- [Animation Patterns](#animation-patterns)
- [Performance Patterns](#performance-patterns)
  - [React.memo for FlatList Header/Footer](#reactmemo-for-flatlist-headerfooter-components)
  - [useMemo for Derived Filtering and Calculations](#usememo-for-derived-filtering-and-calculations)
- [Design System Patterns](#design-system-patterns)
  - [Color Opacity Utility](#color-opacity-utility)
  - [Semantic Theme Values](#semantic-theme-values-over-hardcoded-colors)
  - [Semantic BorderRadius Naming](#semantic-borderradius-naming)
- [Documentation Patterns](#documentation-patterns)
- [Testing Patterns](#testing-patterns)
  - [Pure Function Extraction for Vitest Testability](#pure-function-extraction-for-vitest-testability)
  - [Pure Function Extraction for Server Services](#pure-function-extraction-for-server-services)
  - [Type Guard Over `as` Cast for Runtime Safety](#type-guard-over-as-cast-for-runtime-safety)
  - [vi.resetModules for Env-Dependent Module Testing](#viresetmodules-for-env-dependent-module-testing)

---

## Security Patterns

### IDOR Protection: Auth + Ownership Check

Always verify both authentication AND resource ownership for single-resource endpoints:

```typescript
// Good: Prevents users from accessing other users' items
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid item ID" });
    }

    const item = await storage.getScannedItem(id);

    if (!item || item.userId !== req.userId) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(item);
  },
);
```

```typescript
// Bad: IDOR vulnerability - any authenticated user can access any item
app.get(
  "/api/scanned-items/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    const item = await storage.getScannedItem(req.params.id);
    res.json(item); // No ownership check!
  },
);
```

### SSRF Protection for Server-Side URL Fetching

When the server fetches a user-provided URL (e.g., recipe import, link previews), use the hardened `safeFetch` implementation in `server/services/recipe-import.ts`. It provides:

- **URL blocklist** (`isBlockedUrl`): Blocks localhost, private IPs (IPv4 and IPv6), link-local, hex-encoded IPs, and non-HTTP(S) protocols.
- **DNS rebinding prevention** (`resolveAndValidateHost`): Resolves hostnames via `dns.promises.lookup` and validates the resolved IP against the same blocklist, preventing attackers from using DNS that initially resolves to a public IP then rebinds to a private one.
- **Redirect validation**: Follows redirects manually (`redirect: "manual"`) up to `MAX_REDIRECTS`, re-validating each redirect target against the blocklist and DNS check.
- **Response size limits**: Enforces `MAX_RESPONSE_BYTES` via both `Content-Length` header check and streaming byte count.
- **Timeout**: Uses `AbortSignal.timeout()` to cap total fetch duration.

```typescript
// For URL validation without fetching:
import { isBlockedUrl } from "./services/recipe-import";
if (isBlockedUrl(url)) {
  return { success: false, error: "FETCH_FAILED" };
}

// For full protected fetch, use importRecipeFromUrl which calls safeFetch internally.
// See server/services/recipe-import.ts for the full implementation.
```

**When to use:** Any endpoint where the server fetches a URL supplied by the user (import flows, link previews, webhook callbacks).

**Why:** Without validation, attackers can use the server as a proxy to reach internal services (localhost, AWS metadata at 169.254.169.254, private network hosts). Zod's `z.string().url()` only validates URL syntax, not the target.

**Reference:** `server/services/recipe-import.ts`

### CORS with Pattern Matching

Use origin pattern matching instead of wildcard `*` for CORS:

```typescript
const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^exp:\/\/.+$/,
  /^https:\/\/.+\.loca\.lt$/, // localtunnel
  /^https:\/\/.+\.ngrok\.io$/, // ngrok
];

const publicDomain = process.env.EXPO_PUBLIC_DOMAIN;

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Allow requests with no origin (mobile apps)
  if (publicDomain && origin.includes(publicDomain)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*");
  }
  next();
});
```

**Why:** Prevents malicious domains from making authenticated requests to your API.

### Rate Limiting on Auth Endpoints

Apply aggressive rate limiting to prevent brute force attacks:

```typescript
import rateLimit from "express-rate-limit";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 registrations per hour
  message: { error: "Too many registration attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  // Login logic
});

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  // Register logic
});
```

### Rate Limiting on External API Endpoints

Apply rate limiting to endpoints that call expensive external APIs (OpenAI, payment processors, third-party services):

```typescript
import rateLimit from "express-rate-limit";

const photoRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: { error: "Too many photo uploads. Please wait." },
  keyGenerator: (req) => req.userId || req.ip || "anonymous",
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to endpoints calling external APIs
app.post("/api/photos/analyze", requireAuth, photoRateLimit, upload.single("photo"), ...);
app.post("/api/photos/analyze/:sessionId/followup", requireAuth, photoRateLimit, ...);
```

**Why:** Prevents cost explosion from malicious or accidental overuse of paid APIs.

**Key differences from auth rate limiting:**

| Auth Endpoints              | External API Endpoints          |
| --------------------------- | ------------------------------- |
| Prevent brute force attacks | Prevent cost explosion          |
| Longer windows (15min-1hr)  | Shorter windows (1min)          |
| Tighter limits (5-10 total) | Higher limits per minute        |
| IP-based by default         | User ID-based for authenticated |

### Session Ownership Verification

For in-memory session stores, always include `userId` and verify ownership:

```typescript
interface AnalysisSession {
  userId: string; // Always include owner ID
  result: AnalysisResult;
  createdAt: Date;
}

const sessionStore = new Map<string, AnalysisSession>();

// When creating session:
const sessionId = crypto.randomUUID(); // Use cryptographic randomness
sessionStore.set(sessionId, {
  userId: req.userId!, // Store owner
  result,
  createdAt: new Date(),
});

// When accessing session:
const session = sessionStore.get(sessionId);
if (!session || session.userId !== req.userId!) {
  return res.status(403).json({ error: "Not authorized" });
}
```

**Why:** Prevents users from accessing other users' sessions, even if they guess the session ID.

### Session Timeout Cleanup Pattern

Track timeout references to prevent memory leaks from orphaned timers:

```typescript
const sessionStore = new Map<string, AnalysisSession>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Clear session and its associated timeout.
 * Call this whenever a session is deleted to prevent memory leaks.
 */
function clearSession(sessionId: string): void {
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  sessionStore.delete(sessionId);
}

// When creating session:
const timeoutId = setTimeout(() => {
  sessionStore.delete(sessionId);
  sessionTimeouts.delete(sessionId);
}, SESSION_TIMEOUT);
sessionTimeouts.set(sessionId, timeoutId);

// When session is accessed/confirmed (use clearSession):
clearSession(sessionId);
```

**Why:** Orphaned timeouts consume memory and may reference stale data.

### Multer Error Handler Pattern

Add specific error handling for file upload validation to return 400 (not 500):

```typescript
import multer, { MulterError } from "multer";

// Multer config with fileFilter
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and WebP allowed."));
    }
  },
});

// Error handler (add before createServer)
app.use(
  (
    err: Error,
    req: Request,
    res: Response,
    next: (err?: Error) => void,
  ): void => {
    if (err instanceof MulterError) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    if (err.message?.includes("Invalid file type")) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  },
);
```

**Why:** Without this handler, multer validation errors bubble up as 500 Internal Server Error.

### Input Validation with Zod

Validate ALL user input with Zod schemas before processing:

```typescript
import { z, ZodError } from "zod";

// Define schema
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Validation helper
function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) =>
      e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
    )
    .join("; ");
}

// Usage in route
app.post("/api/auth/register", async (req, res) => {
  try {
    const validated = registerSchema.parse(req.body);
    // Use validated data...
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({ error: formatZodError(error) });
    }
    res.status(500).json({ error: "Internal error" });
  }
});
```

**Why:** Prevents injection attacks, ensures data integrity, provides clear error messages.

---

## TypeScript Patterns

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
      userId?: string;
    }
  }
}
```

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

---

## API Patterns

### Error Response Structure

All API errors should follow this structure:

```typescript
interface ApiError {
  error: string; // Human-readable message
  code?: string; // Machine-readable code for client logic
  details?: Record<string, string>; // Field-specific errors (validation)
}
```

Example error codes:

- `TOKEN_EXPIRED` - JWT token has expired
- `TOKEN_INVALID` - JWT token is malformed or invalid
- `NO_TOKEN` - No authentication token provided
- `VALIDATION_ERROR` - Request body validation failed
- `NOT_FOUND` - Resource not found
- `CONFLICT` - Resource already exists (e.g., duplicate username)
- `LIMIT_REACHED` - User has reached a resource limit (e.g., max saved items)
- `PREMIUM_REQUIRED` - Feature requires a premium subscription
- `DAILY_LIMIT_REACHED` - User has exhausted a daily usage quota
- `DATE_RANGE_LIMIT` - Requested date range exceeds tier allowance
- `LIST_LIMIT_REACHED` - Per-user resource count ceiling hit (e.g., max grocery lists)

### Auth Response Structure

Authentication endpoints return user data plus token:

```typescript
interface AuthResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    dailyCalorieGoal?: number;
    onboardingCompleted?: boolean;
  };
  token: string;
}
```

### Fail-Fast Environment Validation

Validate required environment variables at module load time, not at request time:

```typescript
// Good: Fails immediately on server start
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

export function requireAuth(req, res, next) {
  // JWT_SECRET is guaranteed to exist here
  jwt.verify(token, JWT_SECRET);
}
```

```typescript
// Bad: Fails on first request, harder to debug
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: "Server misconfigured" });
  }
}
```

### Startup Warning for Optional Environment Variables

For optional env vars with rate-limited fallbacks, log a warning at module load time:

```typescript
// Good: Warn at startup when using rate-limited fallback
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  console.warn(
    "⚠️  USDA_API_KEY not set - using DEMO_KEY with 40 requests/hour limit",
  );
}

async function lookupUSDA(query: string): Promise<NutritionData | null> {
  // Use USDA_API_KEY here - no runtime check needed
}
```

```typescript
// Bad: Silent fallback - production surprises
const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
// No warning - developers don't know they're using a rate-limited key
```

**When to use:**

- External API keys with free tier/demo key fallbacks
- Rate-limited fallback values
- Any optional config where the fallback has significant limitations

**Why:** Silent fallbacks cause unexpected failures in production. A startup warning ensures developers are aware of the limitation.

### Stub Service with Production Safety Gate

When integrating third-party services that require credentials not available in development (app store APIs, payment processors, push notification services), create a stub that auto-approves in dev but rejects in production:

```typescript
// server/services/receipt-validation.ts

/**
 * Stub mode activates when the required credential is missing.
 * Two-layer defense: environment variable presence + NODE_ENV check.
 */
const STUB_MODE = !process.env.APPLE_SHARED_SECRET;

export async function validateReceipt(
  receipt: string,
  platform: Platform,
): Promise<ReceiptValidationResult> {
  if (STUB_MODE) {
    // Layer 2: Even if STUB_MODE, reject in production
    if (process.env.NODE_ENV === "production") {
      console.error(
        "Receipt validation is stubbed in production — rejecting. " +
          "Set APPLE_SHARED_SECRET to enable.",
      );
      return { valid: false, errorCode: "NOT_IMPLEMENTED" };
    }
    console.warn("Receipt validation is stubbed — auto-approving in dev.");
    return { valid: true, expiresAt: oneYearFromNow() };
  }

  // Real implementation when credentials are available
  return platform === "ios"
    ? validateAppleReceipt(receipt)
    : validateGoogleReceipt(receipt);
}
```

```typescript
// Bad: Boolean flag with no production protection
const USE_STUB = true; // Developer forgets to change before deploy
export async function validateReceipt(...) {
  if (USE_STUB) return { valid: true }; // Auto-approves in production!
}
```

**Key elements:**

1. **Derive stub mode from credential presence** (`!process.env.X`), not a manual boolean flag
2. **Two-layer defense**: stub mode check + production NODE_ENV rejection
3. **Log loudly**: `console.error` in production, `console.warn` in dev
4. **Return failure, not success** when stubbed in production

**When to use:**

- Payment/receipt validation (App Store, Google Play)
- Push notification services (APNs, FCM)
- SMS/email verification services
- Any third-party service requiring production-only credentials

**Reference:** `server/services/receipt-validation.ts`

### Tier-Gated Route Guards

When a route's behavior varies by subscription tier (premium-only access, different limits for free vs premium), check `TIER_FEATURES[tier]` early in the handler and return a typed error code:

```typescript
// Premium-only feature gate
const subscription = await storage.getSubscriptionStatus(req.userId!);
const tier = subscription?.tier || "free";
const features = TIER_FEATURES[tier];

if (!features.aiMealSuggestions) {
  res.status(403).json({
    error: "AI meal suggestions require a premium subscription",
    code: "PREMIUM_REQUIRED",
  });
  return;
}

// Tier-dependent limit gate
const dailyCount = await storage.getDailyMealSuggestionCount(
  req.userId!,
  new Date(),
);
if (dailyCount >= features.dailyAiSuggestions) {
  res.status(429).json({
    error: "Daily AI suggestion limit reached",
    code: "DAILY_LIMIT_REACHED",
    remainingToday: 0,
  });
  return;
}

// Tier-dependent parameter constraint
const maxDays = features.extendedPlanRange ? 90 : 7;
if (daysDiff > maxDays) {
  res.status(403).json({
    error: `Date range limited to ${maxDays} days on ${tier} plan`,
    code: "DATE_RANGE_LIMIT",
  });
  return;
}
```

**Key elements:**

1. **Fail-fast order**: validation -> auth -> tier gate -> business logic. Tier checks go after auth but before expensive operations
2. **Return typed `code`** strings that the client `ApiError` class can match on (see Client State Patterns > Typed ApiError Class)
3. **Use 403 for feature locks**, 429 for usage limits, 400 for hard resource ceilings
4. **Default to `"free"`** when subscription data is missing — never grant premium by default
5. **All numeric limits must come from `TIER_FEATURES`** — never hardcode a number (like `6` for max saved items). Hardcoded values silently drift from the config when tier limits change. The flow is: add to `PremiumFeatures` interface -> set in `TIER_FEATURES` per tier -> read via `features.X` at the call site

**When to use:**

- Premium-only features (AI suggestions, extended date ranges)
- Tiered usage limits (daily quotas, resource counts)
- Any route where free and premium users have different capabilities

**When NOT to use:**

- Auth-only gates (use `requireAuth` middleware)
- Rate limiting for abuse prevention (use `express-rate-limit` middleware)

**References:**

- `server/routes.ts` — meal suggestion, grocery list creation routes
- `shared/types/premium.ts` — `TIER_FEATURES` config object, `PremiumFeatures` interface
- Client-side: see "Typed ApiError Class" and "Premium Feature Gating UI" patterns

### checkPremiumFeature Helper for Tier Gates

When multiple routes need the same premium-gating logic (fetch subscription, resolve tier, check feature flag, send 403), extract a shared `checkPremiumFeature()` helper instead of duplicating the block in every handler. The helper returns the full `PremiumFeatures` object on success (so the caller can check additional tier-dependent limits) or sends a 403 and returns `null` on failure.

```typescript
/**
 * Check if the user has a premium feature. Returns the features object if granted,
 * or sends a 403 response and returns null if not.
 */
async function checkPremiumFeature(
  req: Request,
  res: Response,
  featureKey: keyof PremiumFeatures,
  featureLabel: string,
): Promise<PremiumFeatures | null> {
  const subscription = await storage.getSubscriptionStatus(req.userId!);
  const tier = subscription?.tier || "free";
  const features = TIER_FEATURES[isValidSubscriptionTier(tier) ? tier : "free"];
  if (!features[featureKey]) {
    res.status(403).json({
      error: `${featureLabel} requires a premium subscription`,
      code: "PREMIUM_REQUIRED",
    });
    return null;
  }
  return features;
}

// Usage in route handler — early return on null
app.get("/api/pantry", requireAuth, async (req, res) => {
  const features = await checkPremiumFeature(
    req,
    res,
    "pantryTracking",
    "Pantry tracking",
  );
  if (!features) return; // 403 already sent

  // features is PremiumFeatures — can check additional limits
  const items = await storage.getPantryItems(req.userId!);
  res.json(items);
});
```

**When to use:** Any route with a simple boolean premium feature gate. If 3+ routes check the same pattern (fetch subscription -> resolve tier -> check flag -> send 403), use this helper.

**When NOT to use:**

- Routes that need tier-dependent **limits** (daily quotas, range limits) — those need custom logic after the feature check. You can still use `checkPremiumFeature` for the initial boolean gate and then use the returned `features` object for limit checks.
- Single-use gates where the overhead of a helper isn't justified.

**Key design choices:**

1. Returns `PremiumFeatures | null` rather than `boolean` so callers can use tier-dependent limits from the same object
2. Uses `isValidSubscriptionTier()` type guard internally — never `as SubscriptionTier`
3. Sends the 403 response itself — caller just checks for `null` and returns

**References:**

- `server/routes.ts` — pantry, grocery, meal confirmation routes all use this
- See also: "Tier-Gated Route Guards" (above) for the inline pattern this replaces
- See also: "Type Guard Over `as` Cast" in Testing Patterns

### Atomic Server Endpoints Over Multi-Request Flows

When a client action requires multiple related mutations (e.g., create a record + update a flag on another record), create a single server endpoint that performs both operations atomically rather than having the client make multiple sequential requests.

```typescript
// Bad: Client makes 2 requests that can leave data inconsistent if one fails
const addToPantry = async (item: GroceryItem) => {
  await apiRequest("POST", "/api/pantry", { name: item.name, ... });        // Step 1
  await apiRequest("PUT", `/api/grocery-items/${item.id}`, { addedToPantry: true }); // Step 2 - what if this fails?
};

// Good: Single atomic endpoint handles both operations
const addToPantry = async (listId: number, itemId: number) => {
  await apiRequest("POST", `/api/meal-plan/grocery-lists/${listId}/items/${itemId}/add-to-pantry`);
};

// Server handler — both operations succeed or fail together
app.post("/api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry",
  requireAuth,
  async (req, res) => {
    // Verify ownership, create pantry item, flag grocery item — all in one handler
    const pantryItem = await storage.createPantryItem({ ... });
    await storage.updateGroceryItemFlag(listId, itemId, { addedToPantry: true });
    res.status(201).json(pantryItem);
  },
);
```

**When to use:**

- Two or more writes that are logically one user action (check off + add to pantry, confirm meal + create daily log)
- When partial failure would leave the UI in an inconsistent state
- When the client would need to coordinate rollback logic

**When NOT to use:**

- Independent operations that the user performs separately
- Read-then-write patterns where the read result determines the write (use optimistic updates instead)

**Key benefits:**

1. **Atomicity** — both operations succeed or fail together (use `db.transaction()` if strict DB atomicity is needed)
2. **Fewer round trips** — one HTTP request instead of two
3. **Simpler client code** — single mutation hook with single invalidation
4. **No partial state** — UI never shows "added to pantry" without the grocery flag being set

**References:**

- `server/routes.ts` — `POST /api/meal-plan/grocery-lists/:id/items/:itemId/add-to-pantry`
- `client/hooks/useGroceryList.ts` — `useAddGroceryItemToPantry` mutation

### Pagination with useInfiniteQuery

Use TanStack Query's `useInfiniteQuery` for paginated lists:

```typescript
const PAGE_SIZE = 50;

async function fetchScannedItems({
  pageParam = 0,
}): Promise<PaginatedResponse> {
  const token = await tokenStorage.get();
  const baseUrl = getApiUrl();
  const url = new URL("/api/scanned-items", baseUrl);
  url.searchParams.set("limit", PAGE_SIZE.toString());
  url.searchParams.set("offset", pageParam.toString());

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return await res.json();
}

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  refetch,
} = useInfiniteQuery<PaginatedResponse>({
  queryKey: ["api", "scanned-items"],
  queryFn: fetchScannedItems,
  getNextPageParam: (lastPage, allPages) => {
    const totalFetched = allPages.reduce(
      (sum, page) => sum + page.items.length,
      0,
    );
    return totalFetched < lastPage.total ? totalFetched : undefined;
  },
  initialPageParam: 0,
});

// Flatten pages for FlatList
const allItems = data?.pages.flatMap((page) => page.items) ?? [];
```

**Server-side:** Validate and cap pagination parameters:

```typescript
app.get("/api/scanned-items", requireAuth, async (req, res) => {
  const limit = Math.min(
    Math.max(parseInt(req.query.limit as string) || 50, 1),
    100, // Maximum 100 items per page
  );
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const result = await storage.getScannedItems(req.userId!, limit, offset);
  res.json(result);
});
```

---

## External API Patterns

### Per-Field Fallback for Partial Data

When consuming external APIs that may return partial data, use nullish coalescing (`??`) per-field rather than all-or-nothing fallback:

```typescript
// Good: Each field falls back independently
const nutriments = apiResponse.nutriments || {};

setNutrition({
  calories: nutriments["energy-kcal_serving"] ?? nutriments["energy-kcal_100g"],
  protein: nutriments.proteins_serving ?? nutriments.proteins_100g,
  carbs: nutriments.carbohydrates_serving ?? nutriments.carbohydrates_100g,
  fat: nutriments.fat_serving ?? nutriments.fat_100g,
  fiber: nutriments.fiber_serving ?? nutriments.fiber_100g,
});
```

```typescript
// Bad: All-or-nothing fallback loses partial data
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;

setNutrition({
  calories: hasServingData
    ? nutriments["energy-kcal_serving"]
    : nutriments["energy-kcal_100g"],
  protein: hasServingData
    ? nutriments.proteins_serving // Could be undefined even when hasServingData is true!
    : nutriments.proteins_100g,
  // ...
});
```

**When to use:** External APIs (OpenFoodFacts, nutrition databases, third-party services) where different fields may have different data availability.

**Why:** External APIs often have inconsistent data coverage. A product might have per-serving calories but only per-100g fiber data. Per-field fallback ensures you get the best available data for each field.

### Indicate Data Source to Users

When falling back to different data formats, inform users what they're seeing:

```typescript
const hasServingData = nutriments["energy-kcal_serving"] !== undefined;
setIsPer100g(!hasServingData);

// In UI:
<ThemedText>
  Calories{isPer100g ? " (per 100g)" : ""}
</ThemedText>

{isPer100g && (
  <InfoMessage>
    Values shown per 100g. Check package for actual serving size.
  </InfoMessage>
)}
```

**Why:** Prevents user confusion when displayed values don't match package labels.

### External Resource Dedup on Save

When saving resources from external catalogs or imports, check for an existing record by `externalId + userId` before fetching full details and inserting. This prevents duplicate DB entries and unnecessary API calls:

```typescript
// In route handler — check for existing record before expensive API call
const existing = await storage.findMealPlanRecipeByExternalId(
  req.userId!,
  externalId,
);
if (existing) {
  return res.json(existing); // Already saved, return existing
}

// Only now fetch full details from external API
const detail = await getCatalogRecipeDetail(externalId);
const saved = await storage.createMealPlanRecipe(detail);
res.status(201).json(saved);
```

```typescript
// In storage layer — composite lookup by userId + externalId
async findMealPlanRecipeByExternalId(
  userId: number,
  externalId: string,
): Promise<MealPlanRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.userId, userId),
        eq(mealPlanRecipes.externalId, externalId),
      ),
    );
  return recipe;
}
```

**When to use:** Any feature that saves external resources into local DB (catalog imports, bookmark/save flows, third-party sync).

**Why:** Users may tap "save" multiple times or revisit a catalog item. Without dedup, you get duplicate rows and wasted API quota. The userId scope ensures different users can independently save the same external resource.

**Reference:** `POST /api/meal-plan/catalog/:id/save` in `server/routes.ts`, `server/storage.ts`

### Multi-Source Nutrition Lookup Chain

When a single API cannot reliably provide accurate data, use a priority chain of
sources with cross-validation:

```typescript
// server/services/nutrition-lookup.ts
// Priority: CNF → USDA → API Ninjas
export async function lookupNutrition(
  query: string,
): Promise<NutritionData | null> {
  // 1. Try Canadian Nutrient File (bilingual, high accuracy)
  const cnfResult = await lookupCNF(query);
  if (cnfResult) return { ...cnfResult, source: "cnf" };

  // 2. Try USDA FoodData Central
  const usdaResult = await lookupUSDA(query);
  if (usdaResult) return { ...usdaResult, source: "usda" };

  // 3. Last resort: API Ninjas
  const ninjasResult = await lookupAPINinjas(query);
  if (ninjasResult) return { ...ninjasResult, source: "api-ninjas" };

  return null;
}
```

**When to use:** Any feature requiring reliable data from external sources where
no single API has complete coverage (nutrition, product catalogs, geocoding, etc.).

**Why:** Individual APIs have gaps. OFF may have French names that confuse USDA.
CNF is authoritative for Canadian products. The chain ensures best available data.

**Reference:** `server/services/nutrition-lookup.ts`

### Barcode Padding Normalization

Barcodes can be encoded in different formats (UPC-A 12-digit, EAN-13 13-digit).
Generate all plausible variants and try each one:

```typescript
function barcodeVariants(raw: string): string[] {
  const variants = new Set<string>();
  variants.add(raw);

  // Zero-pad to 12 or 13 digits
  const padded12 = raw.padStart(12, "0");
  const padded13 = raw.padStart(13, "0");
  variants.add(padded12);
  variants.add(padded13);

  // Compute check digits for UPC-A and EAN-13
  variants.add(computeUPCA(raw));
  variants.add(computeEAN13(raw));

  return [...variants].filter((v) => /^\d{8,14}$/.test(v));
}
```

**When to use:** Any barcode lookup where the scanned code may differ in
format from what the database stores (leading zeros, check digits, padding).

**Why:** A scanner may return `"60731142363"` (11 digits) while the database
stores `"060731142363"` (12-digit UPC-A with leading zero). Without
normalization, valid products appear as "not found."

**Reference:** `barcodeVariants()`, `computeUPCA()`, `computeEAN13()` in `server/services/nutrition-lookup.ts`

### Cross-Validation Between Data Sources

When primary data is suspect, compare against a secondary source and prefer
the more plausible result:

```typescript
// If OFF reports >2× the calories of the secondary source, prefer secondary
const offCalories = offData.calories;
const secondaryCalories = secondaryData.calories;

if (offCalories > secondaryCalories * 2) {
  // OFF likely has a full-box serving size; prefer secondary
  return { ...secondaryData, productName: offData.productName };
}

// Sources agree: use OFF but fill gaps from secondary
return {
  ...offData,
  fiber: offData.fiber ?? secondaryData.fiber,
  sugar: offData.sugar ?? secondaryData.sugar,
};
```

**When to use:** Any integration where the primary source may have inaccurate
data (e.g., community-contributed databases like Open Food Facts).

**Why:** OFF sometimes reports nutrition for the full box instead of one serving
(e.g., 944 kcal for a Keurig pod box instead of 60 kcal for one pod).
Cross-validation catches these errors automatically.

**Reference:** Cross-validation logic in `lookupBarcode()`, `server/services/nutrition-lookup.ts`

### Graceful 404 Handling with Raw Fetch

When a 404 is an expected outcome (not an error), bypass `apiRequest()` and use
raw `fetch` to inspect the response body:

```typescript
// apiRequest() calls throwIfResNotOk() which throws on 404
// For barcode lookup, 404 means "product not in database" — not an error

const baseUrl = getApiUrl();
const token = await tokenStorage.getToken();
const response = await fetch(`${baseUrl}/api/nutrition/barcode/${barcode}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const data = await response.json();

if (data.notInDatabase) {
  setShowManualSearch(true); // Expected path, not an error
}
```

**When to use:** Any endpoint where specific non-2xx status codes represent valid
application states rather than errors (404 = "not found, try manual search",
409 = "already exists", etc.).

**Why:** A shared `apiRequest()` helper that throws on all non-2xx responses is
a good default, but it prevents handling expected non-2xx responses gracefully.

**Reference:** `fetchBarcodeData()` in `client/screens/NutritionDetailScreen.tsx`

### Fetch Timeout with AbortSignal for External APIs

Every outbound `fetch()` to an external API must include `AbortSignal.timeout()` to prevent hung connections from blocking server resources indefinitely. Node.js `fetch` has no default timeout — a slow or unresponsive upstream will hold the connection open until the OS-level TCP timeout (often 2+ minutes).

```typescript
/** Timeout for outbound API requests (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

// Good: Explicit timeout prevents hung connections
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});

// Bad: No timeout — connection hangs if upstream is slow
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
});
```

**When to use:** Every `fetch()` call to an external API (payment processors, nutrition databases, OAuth endpoints, third-party services). Define the timeout as a named constant at module level.

**When NOT to use:** Internal service calls where you control both endpoints and have other timeout mechanisms (e.g., Express request timeout middleware).

**Recommended timeouts:**

- Payment/auth APIs (Google OAuth, Apple receipt): `10_000` (10s)
- Data APIs (USDA, nutrition lookup): `10_000` (10s)
- Large content fetches (recipe import, URL scraping): `15_000`-`30_000` (15-30s)

**Rationale:** The receipt-validation code review found that both Google OAuth token exchange and subscription verification calls had no timeouts. In production, a hung Google API call would block the subscription upgrade endpoint indefinitely. `AbortSignal.timeout()` is the modern Node.js approach (available since Node 18) and is cleaner than manual `AbortController` + `setTimeout` patterns.

**References:**

- `server/services/receipt-validation.ts` — Google OAuth and subscription API calls
- `server/services/recipe-import.ts` — `safeFetch` already uses `AbortSignal.timeout()`
- Related learning: "Fetch Without Timeout Hangs Indefinitely" in LEARNINGS.md

### Zod safeParse for External API Responses

When consuming JSON from external APIs (payment providers, third-party services, OAuth endpoints), validate the response shape with a Zod schema using `safeParse()` instead of casting with `as`. External APIs can change their response format without warning, and `as` casts provide zero runtime protection.

```typescript
import { z } from "zod";

// Define a schema for the expected response shape
const googleOAuthResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

// Good: safeParse validates the shape at runtime
const raw = await response.json();
const parsed = googleOAuthResponseSchema.safeParse(raw);
if (!parsed.success) {
  console.error("Unexpected API response shape:", parsed.error);
  return { valid: false, errorCode: "STORE_API_ERROR" };
}
// parsed.data is now typed and validated
const token = parsed.data.access_token;
```

```typescript
// Bad: as cast trusts the API response blindly
const data = (await response.json()) as {
  access_token: string;
  expires_in: number;
};
// If Google changes the response, `data.access_token` is undefined
// and the error surfaces far from where the data was received
```

**When to use:**

- Any `response.json()` from an external API (Google Play, Apple App Store, Spoonacular, USDA, etc.)
- Decoded payloads from JWS/JWT tokens
- Webhook payloads from third-party services

**When NOT to use:**

- Internal API responses where you control the server (use shared types instead)
- Responses already validated by a client SDK that provides typed results

**Pattern:** Define the schema next to the function that consumes the response. Use `safeParse()` (not `parse()`) so you can return a structured error instead of throwing. Keep schemas minimal — only validate fields you actually use.

**Rationale:** During the receipt-validation code review, three `as` casts on Google API and Apple JWS payloads were replaced with Zod schemas. This catches API-breaking changes at the validation boundary rather than letting invalid data propagate into business logic.

**References:**

- `server/services/receipt-validation.ts` — `appleTransactionSchema`, `googleOAuthResponseSchema`, `googleSubscriptionResponseSchema`
- `server/services/recipe-catalog.ts` — `catalogSearchResponseSchema`, `recipeDetailSchema`
- `server/services/nutrition-lookup.ts` — `apiNinjasResponseSchema`, `usdaResponseSchema`
- Related pattern: "Zod safeParse with Fallback for Database Values" (for internal data)

---

## Database Patterns

### `text()` Over `pgEnum` for Enum-Like Columns

Use `text()` with application-level validation instead of `pgEnum` for columns with a fixed set of values:

```typescript
// Good: text() with Zod validation at the application boundary
export const transactions = pgTable("transactions", {
  status: text("status").default("pending").notNull(),
  platform: text("platform").notNull(),
});

// Validate at API boundary with Zod
const PlatformSchema = z.enum(["ios", "android"]);
const StatusSchema = z.enum(["pending", "approved", "rejected"]);

// Validate from database with safeParse + fallback
const tier = subscriptionTierSchema.safeParse(row.subscriptionTier);
return tier.success ? tier.data : "free";
```

```typescript
// Avoid: pgEnum creates a database-level type requiring migrations to change
import { pgEnum } from "drizzle-orm/pg-core";

const statusEnum = pgEnum("transaction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const transactions = pgTable("transactions", {
  status: statusEnum("status").default("pending").notNull(),
});
// Adding "refunded" later requires ALTER TYPE ... ADD VALUE migration
```

**Why:**

- Adding/removing values requires a database migration with `pgEnum` but only a code change with `text()`
- Drizzle ORM push (`npm run db:push`) handles `text()` columns cleanly; `pgEnum` changes can cause push conflicts
- Validation belongs at the application boundary (Zod schemas), not the database layer
- All existing tables in this project use `text()` for enum-like fields (subscriptionTier, sourceType, status, platform, mealType, category)

**When to use:** Any column with a constrained set of values (status, type, tier, platform, role).

**Pair with:** "Zod safeParse with Fallback for Database Values" pattern (above) for safe reads, and shared Zod schemas for safe writes.

### Cache-First Pattern for Expensive Operations

When an endpoint performs expensive operations (OpenAI API calls, external service requests, complex computations), check for cached results first:

```typescript
// Route handler with cache-first pattern
app.get("/api/items/:id/suggestions", requireAuth, async (req, res) => {
  const itemId = parseInt(req.params.id, 10);
  const userProfile = await storage.getUserProfile(req.userId!);
  const profileHash = calculateProfileHash(userProfile);

  // 1. Check cache first
  const cached = await storage.getSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
  );
  if (cached) {
    // Increment hit count in background (fire-and-forget)
    storage.incrementCacheHit(cached.id).catch(console.error);
    return res.json({ suggestions: cached.suggestions, cacheId: cached.id });
  }

  // 2. Cache miss: perform expensive operation
  const suggestions = await openai.generateSuggestions(itemId, userProfile);

  // 3. Cache result for future requests
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  const cacheEntry = await storage.createSuggestionCache(
    itemId,
    req.userId!,
    profileHash,
    suggestions,
    expiresAt,
  );

  res.json({ suggestions, cacheId: cacheEntry.id });
});
```

**Storage layer - check expiry inline:**

```typescript
async getSuggestionCache(
  scannedItemId: number,
  userId: string,
  profileHash: string,
): Promise<{ id: number; suggestions: SuggestionData[] } | undefined> {
  const [cached] = await db
    .select({ id: suggestionCache.id, suggestions: suggestionCache.suggestions })
    .from(suggestionCache)
    .where(
      and(
        eq(suggestionCache.scannedItemId, scannedItemId),
        eq(suggestionCache.userId, userId),
        eq(suggestionCache.profileHash, profileHash),
        gt(suggestionCache.expiresAt, new Date()), // Check expiry inline
      ),
    );
  return cached || undefined;
}
```

**When to use:**

- AI-generated content (suggestions, summaries, instructions)
- External API calls with per-request costs
- Complex computations with deterministic outputs
- Any operation taking >500ms that produces cacheable results

**Key elements:**

- Composite cache key (itemId + userId + contextHash)
- TTL-based expiration checked in query
- Return cacheId to enable child cache lookups
- Fire-and-forget hit count tracking

### Fire-and-Forget for Non-Critical Background Operations

When an operation shouldn't block the response but failure should be logged, use the fire-and-forget pattern:

```typescript
// Good: Fire-and-forget with error logging
storage.incrementCacheHit(cached.id).catch(console.error);
storage.invalidateCacheForUser(userId).catch(console.error);
storage.createCacheEntry(data).catch(console.error);

// Response sent immediately, background operation continues
return res.json({ data });
```

```typescript
// Bad: Awaiting non-critical operations delays response
await storage.incrementCacheHit(cached.id);
await storage.invalidateCacheForUser(userId);
return res.json({ data }); // User waited for analytics
```

**When to use:**

- Analytics and hit count tracking
- Cache writes after generating response
- Eager cache invalidation
- Audit logging
- Any operation where:
  - Failure doesn't affect the current request's correctness
  - The user shouldn't wait for completion

**Why `.catch(console.error)`:** Without the catch, unhandled promise rejections can crash Node.js in strict mode. The console.error ensures failures are logged for debugging while not blocking the response.

**When NOT to use:**

- Operations that must succeed before responding (auth, critical writes)
- Operations where failure affects response correctness
- Multi-step transactions where rollback is needed

### Content Hash Invalidation Pattern

When cached content depends on user preferences that can change, use a content hash to detect when cache should be invalidated:

```typescript
// server/utils/profile-hash.ts
import crypto from "crypto";
import type { UserProfile } from "@shared/schema";

/**
 * Calculate hash of profile fields that affect cached content.
 * Cache is invalidated when hash changes.
 */
export function calculateProfileHash(profile: UserProfile | undefined): string {
  const hashInput = JSON.stringify({
    allergies: profile?.allergies ?? [],
    dietType: profile?.dietType ?? null,
    cookingSkillLevel: profile?.cookingSkillLevel ?? null,
    cookingTimeAvailable: profile?.cookingTimeAvailable ?? null,
  });
  return crypto.createHash("sha256").update(hashInput).digest("hex");
}
```

**Store hash with cache entry:**

```typescript
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id)
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id)
    .notNull(),
  profileHash: varchar("profile_hash", { length: 64 }).notNull(), // Store hash
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
```

**Cache lookup includes hash in WHERE clause:**

```typescript
// Cache hit only if profileHash matches current profile state
const cached = await storage.getSuggestionCache(itemId, userId, profileHash);
```

**Eager invalidation on profile update:**

```typescript
app.patch("/api/profile", requireAuth, async (req, res) => {
  const fieldsAffectingCache = [
    "allergies",
    "dietType",
    "cookingSkillLevel",
    "cookingTimeAvailable",
  ];
  const changedCacheFields = fieldsAffectingCache.some(
    (field) => field in req.body,
  );

  const profile = await storage.updateUserProfile(req.userId!, req.body);

  // Eagerly invalidate cache if relevant fields changed
  if (changedCacheFields) {
    storage.invalidateCacheForUser(req.userId!).catch(console.error);
  }

  res.json(profile);
});
```

**When to use:**

- AI-generated content personalized to user preferences
- Computed results that depend on user settings
- Any cache where content correctness depends on user profile state

**Why hash instead of timestamp:** Hash provides content-based invalidation. A user could update their profile (changing timestamp) without changing relevant fields, so timestamp-based invalidation would over-invalidate.

### Parent-Child Cache with Cascade Delete

When caching hierarchical data (parent suggestions with child instructions), use foreign key cascade delete for automatic cleanup:

```typescript
// Schema: Parent cache
export const suggestionCache = pgTable("suggestion_cache", {
  id: serial("id").primaryKey(),
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  suggestions: jsonb("suggestions").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// Schema: Child cache with cascade delete from parent
export const instructionCache = pgTable("instruction_cache", {
  id: serial("id").primaryKey(),
  suggestionCacheId: integer("suggestion_cache_id")
    .references(() => suggestionCache.id, { onDelete: "cascade" }) // Auto-delete when parent deleted
    .notNull(),
  suggestionIndex: integer("suggestion_index").notNull(),
  instructions: text("instructions").notNull(),
});
```

**Pass parent cacheId to enable child lookups:**

```typescript
// Parent response includes cacheId
res.json({ suggestions: cached.suggestions, cacheId: cached.id });

// Client passes cacheId when requesting child data
const { data } = useQuery({
  queryKey: [`/api/items/${itemId}/suggestions/${index}/instructions`],
  queryFn: () => apiRequest("POST", url, { cacheId, ... }),
  enabled: !!cacheId,
});
```

**When to use:**

- Suggestions with expandable instructions
- Search results with cached detail views
- Any parent-child content relationship where child validity depends on parent

**Benefits:**

- Single delete operation cleans up all related cache entries
- No orphaned child cache entries
- Database enforces consistency

### Indexes for Foreign Keys and Sort Columns

Add indexes to columns used in WHERE clauses and ORDER BY:

```typescript
export const scannedItems = pgTable(
  "scanned_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    productName: text("product_name").notNull(),
    scannedAt: timestamp("scanned_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    // ... other columns
  },
  (table) => ({
    userIdIdx: index("scanned_items_user_id_idx").on(table.userId),
    scannedAtIdx: index("scanned_items_scanned_at_idx").on(table.scannedAt),
  }),
);
```

**Why:**

- `userId` index: Fast filtering by user (every query filters by user)
- `scannedAt` index: Fast sorting for history screen (ORDER BY scannedAt DESC)

### NOT NULL on Foreign Keys

Always mark foreign key columns as NOT NULL unless nulls are explicitly needed:

```typescript
export const dailyLogs = pgTable("daily_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must have a user
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must reference an item
  // ...
});
```

**Why:** Prevents orphaned records and enforces referential integrity at the database level.

### Inline Transactions for Multi-Table Operations

Use `db.transaction()` directly when operations must be atomic:

```typescript
// Good: Inline transaction
const profile = await db.transaction(async (tx) => {
  const [existing] = await tx
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, req.userId!));

  let result;
  if (existing) {
    [result] = await tx
      .update(userProfiles)
      .set({ ...profileData, updatedAt: new Date() })
      .where(eq(userProfiles.userId, req.userId!))
      .returning();
  } else {
    [result] = await tx
      .insert(userProfiles)
      .values({ ...profileData, userId: req.userId! })
      .returning();
  }

  await tx
    .update(users)
    .set({ onboardingCompleted: true })
    .where(eq(users.id, req.userId!));

  return result;
});
```

```typescript
// Bad: Over-abstracted transaction helper
async function withTransaction<T>(
  callback: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(callback);
}

// Adds indirection with no benefit
const profile = await withTransaction(async (tx) => {
  // Same logic as above
});
```

**Why:** Inline transactions are clearer, easier to debug, and avoid unnecessary abstraction layers.

### LEFT JOIN with COALESCE for Nullable Foreign Keys

When a table has nullable foreign keys that can reference different source tables (e.g., `dailyLogs` can have nutrition from `scannedItems` OR `mealPlanRecipes`), use LEFT JOINs with nested COALESCE to pull values from whichever source is present.

```typescript
const result = await db
  .select({
    totalCalories: sql<number>`COALESCE(SUM(
      COALESCE(
        CAST(${scannedItems.calories} AS DECIMAL),
        CAST(${mealPlanRecipes.caloriesPerServing} AS DECIMAL),
        0
      ) * CAST(${dailyLogs.servings} AS DECIMAL)
    ), 0)`,
    // ... repeat for protein, carbs, fat
    itemCount: sql<number>`COUNT(${dailyLogs.id})`,
  })
  .from(dailyLogs)
  .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
  .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id))
  .where(
    and(
      eq(dailyLogs.userId, userId),
      gte(dailyLogs.loggedAt, startOfDay),
      lt(dailyLogs.loggedAt, endOfDay),
    ),
  );
```

**When to use:**

- Aggregation queries where the main table has multiple nullable FKs pointing to different source tables
- Summary queries that must include rows regardless of which source provided the data

**When NOT to use:**

- Simple queries where the FK is always non-null (use INNER JOIN)
- Queries that should exclude rows with no match (use INNER JOIN intentionally)

**Key pitfalls:**

1. **INNER JOIN breaks on NULL FK** — if `scannedItemId` is null, INNER JOIN drops the row entirely, making confirmed meal plan items invisible in summaries
2. **Double COALESCE** — outer COALESCE handles the SUM being null (no rows), inner COALESCE handles per-row fallback between multiple source columns
3. **CAST is required** — Drizzle's `text()` columns storing numbers need explicit CAST to DECIMAL for arithmetic

**References:**

- `server/storage.ts` — `getDailySummary()` method
- Related learning: "getDailySummary LEFT JOIN Rewrite" in LEARNINGS.md

### Pre-Fetched IDs to Avoid Redundant Queries

When a route handler needs data that is also needed by a called function, fetch it once and pass it in rather than letting the function query it again.

```typescript
// Bad: daily-summary route fetches confirmedIds, then getPlannedNutritionSummary
// fetches them again internally
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const summary = await storage.getDailySummary(req.userId!, date);
  const confirmedIds = await storage.getConfirmedMealPlanItemIds(req.userId!, date);
  const planned = await storage.getPlannedNutritionSummary(req.userId!, date);
  //                                          ^ internally calls getConfirmedMealPlanItemIds AGAIN
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Good: Fetch once, pass to dependent function via optional parameter
app.get("/api/daily-summary", requireAuth, async (req, res) => {
  const [summary, confirmedIds] = await Promise.all([
    storage.getDailySummary(req.userId!, date),
    storage.getConfirmedMealPlanItemIds(req.userId!, date),
  ]);
  const planned = await storage.getPlannedNutritionSummary(
    req.userId!, date, confirmedIds, // Pass pre-fetched IDs
  );
  res.json({ ...summary, ...planned, confirmedMealPlanItemIds: confirmedIds });
});

// Storage method accepts optional pre-fetched data
async getPlannedNutritionSummary(
  userId: string,
  date: Date,
  confirmedIds?: number[], // Optional — falls back to internal query
): Promise<PlannedSummary> {
  const excludeIds = confirmedIds ?? (await this.getConfirmedMealPlanItemIds(userId, date));
  // ... use excludeIds
}
```

**When to use:**

- A route handler and a called function both need the same data
- The data involves a database query that would otherwise run twice
- The function is also called from other contexts where pre-fetching is not available (hence optional parameter)

**When NOT to use:**

- The shared data is trivial to compute (no DB call)
- Only one caller exists — just inline the query

**References:**

- `server/routes.ts` — daily-summary endpoint
- `server/storage.ts` — `getPlannedNutritionSummary(userId, date, confirmedIds?)`

---

## Client State Patterns

### In-Memory Caching for Frequent Reads

When a value is read frequently but changes rarely, cache in memory with lazy initialization:

```typescript
let cachedValue: string | null = null;
let cacheInitialized = false;

export const storage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      try {
        cachedValue = await AsyncStorage.getItem(KEY);
      } catch (error) {
        console.error("Storage read failed:", error);
        cachedValue = null;
      }
      cacheInitialized = true;
    }
    return cachedValue;
  },

  async set(value: string): Promise<void> {
    cachedValue = value;
    cacheInitialized = true;
    await AsyncStorage.setItem(KEY, value);
  },

  async clear(): Promise<void> {
    cachedValue = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(KEY);
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedValue = null;
  },
};
```

**When to use:** Token storage, user preferences, feature flags.

**When NOT to use:** Data that changes frequently or needs real-time accuracy.

### Authorization Header Pattern

Include auth token via Authorization header, not cookies:

```typescript
const token = await tokenStorage.get();

const headers: HeadersInit = {};
if (data) {
  headers["Content-Type"] = "application/json";
}
if (token) {
  headers["Authorization"] = `Bearer ${token}`;
}

const response = await fetch(url, { method, headers, body });
```

**Why:** React Native/Expo Go does not reliably persist HTTP cookies. Authorization headers work consistently across all platforms.

### Handle 401 Globally

Clear auth state on any 401 response:

```typescript
if (response.status === 401) {
  await tokenStorage.clear();
  // Trigger re-authentication flow
}
```

### Business Logic Errors in Mutations

When an API returns a business logic error (like `LIMIT_REACHED`) that should not trigger error states, use custom fetch logic in the mutation to return a discriminated union instead of throwing:

```typescript
// Good: Return discriminated union for business logic errors
export function useCreateSavedItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (item: CreateSavedItemInput) => {
      const baseUrl = getApiUrl();
      const token = await tokenStorage.get();

      const response = await fetch(`${baseUrl}/api/saved-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(item),
      });

      // Handle business logic error (403 with specific code)
      if (response.status === 403) {
        const data = await response.json();
        if (data.error === "LIMIT_REACHED") {
          return { limitReached: true as const };
        }
        throw new Error(data.message || "Forbidden");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }

      const savedItem = (await response.json()) as SavedItem;
      return { limitReached: false as const, item: savedItem };
    },
    onSuccess: (data) => {
      // Only invalidate cache if operation succeeded
      if (!data.limitReached) {
        queryClient.invalidateQueries({ queryKey: ["/api/saved-items"] });
      }
    },
  });
}

// Usage in component
const createMutation = useCreateSavedItem();

const handleSave = async () => {
  const result = await createMutation.mutateAsync(item);

  if (result.limitReached) {
    // Show upgrade prompt or limit warning
    setShowLimitReachedModal(true);
  } else {
    // Success path
    haptics.notification(NotificationFeedbackType.Success);
  }
};
```

```typescript
// Bad: Using apiRequest which throws on all non-2xx responses
export function useCreateSavedItem() {
  return useMutation({
    mutationFn: async (item: CreateSavedItemInput) => {
      // apiRequest throws on 403, triggering error state
      return await apiRequest<SavedItem>("POST", "/api/saved-items", item);
    },
    onError: (error) => {
      // Can't distinguish LIMIT_REACHED from other 403 errors
      // Must parse error message string - fragile!
    },
  });
}
```

**When to use:**

- Resource limits (max items, storage quota)
- Soft validation failures (duplicate name, conflicting schedule)
- Any 4xx error that represents a recoverable business condition

**When NOT to use:**

- Authentication errors (401) - use global handler
- Server errors (5xx) - let TanStack Query handle retry/error state
- Validation errors on form fields - use form validation library

**Why discriminated union:** TypeScript can narrow `result` based on `limitReached`, ensuring you handle both cases. The `as const` assertion makes the literal type precise.

### Typed ApiError Class for Client-Side Error Differentiation

When mutation hooks call `apiRequest` and need to **throw** on errors (rather than returning a discriminated union), use the `ApiError` class to carry a machine-readable `code` through TanStack Query's error flow:

```typescript
// client/lib/api-error.ts
export class ApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

// In the mutation hook — throw ApiError with the server's error code
import { ApiError } from "@/lib/api-error";

export function useMealSuggestions() {
  return useMutation({
    mutationFn: async (params) => {
      const res = await apiRequest("POST", "/api/meal-plan/suggest", params);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new ApiError(body.error || `${res.status}`, body.code);
      }
      return res.json();
    },
  });
}

// In the component — check error type without string parsing
const mutation = useMealSuggestions();

const isLimitReached =
  mutation.error instanceof ApiError &&
  mutation.error.code === "DAILY_LIMIT_REACHED";

if (isLimitReached) {
  // Show specific limit-reached UI
}
```

**When to use:**

- The error should trigger TanStack Query's `isError` state (loading spinners stop, retry is available)
- Multiple distinct error codes from the same endpoint need different UI treatment
- The component reads `mutation.error` to decide what to render

**When NOT to use:**

- The "error" is a recoverable business condition that should not show error UI — use "Business Logic Errors in Mutations" (discriminated union) instead
- Only one kind of error matters and a simple `isError` check suffices

**Choosing between ApiError throw vs discriminated union return:**

| Criterion                           | ApiError (throw)           | Discriminated Union (return)   |
| ----------------------------------- | -------------------------- | ------------------------------ |
| Should TanStack show error state?   | Yes                        | No                             |
| Need to distinguish error subtypes? | Yes, via `error.code`      | Yes, via `result.limitReached` |
| Typical use case                    | Rate limits, premium gates | Soft limits, save conflicts    |

**References:**

- `client/lib/api-error.ts` — ApiError class
- `client/hooks/useMealSuggestions.ts` — throws ApiError
- `client/components/MealSuggestionsModal.tsx` — checks `error.code`
- Server-side: see "Tier-Gated Route Guards" and "Error Response Structure" patterns

### useQuery Over useState+useEffect for Server Data

Always use TanStack Query's `useQuery` (or `useMutation`) for fetching server data. Never use the `useState` + `useEffect` pattern to fetch and store server data manually.

```typescript
// Bad: Manual fetch with useState+useEffect
const [confirmedIds, setConfirmedIds] = useState<number[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  async function fetch() {
    setLoading(true);
    const res = await apiRequest("GET", "/api/daily-summary");
    const data = await res.json();
    setConfirmedIds(data.confirmedMealPlanItemIds ?? []);
    setLoading(false);
  }
  fetch();
}, [date]);
// Problems: no caching, no refetch on focus, no error handling, no deduplication

// Good: useQuery + useMemo for derived state
const { data: dailySummary, isLoading } = useQuery({
  queryKey: ["/api/daily-summary", date],
  queryFn: async () => {
    const res = await apiRequest("GET", `/api/daily-summary?date=${date}`);
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  },
});

const confirmedIds = useMemo(
  () => new Set(dailySummary?.confirmedMealPlanItemIds ?? []),
  [dailySummary?.confirmedMealPlanItemIds],
);
```

**When to use:** Always, for any data fetched from the server.

**When NOT to use:** Client-only state (form inputs, UI toggles, animation values) should use `useState` or `useRef`.

**Key benefits:**

1. **Automatic caching and deduplication** — multiple components requesting the same data get a single request
2. **Refetch on focus** — data refreshes when user returns to the screen
3. **Loading/error states** — built-in `isLoading`, `error`, `isRefetching`
4. **Derived data via `useMemo`** — transform query results without re-fetching

**References:**

- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — derives `confirmedIds` Set from daily summary query
- `client/hooks/useMealPlan.ts` — all meal plan data fetching via useQuery

### `enabled` Parameter for Premium-Gated Queries

When a query fetches data for a premium-only feature, pass an `enabled` parameter to prevent free-tier users from making unnecessary API calls that would return 403.

```typescript
// Hook accepts enabled parameter with sensible default
export function useExpiringPantryItems(enabled = true) {
  return useQuery<PantryItem[]>({
    queryKey: ["/api/pantry/expiring"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/pantry/expiring");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled, // Only fires when enabled is true
  });
}

// Caller passes premium feature flag
const features = usePremiumFeatures();
const { data: expiringItems } = useExpiringPantryItems(features.pantryTracking);
```

**When to use:**

- Any query hook that fetches premium-only data
- Queries gated behind a feature flag or user capability
- Conditional data fetching where the condition is known upfront

**When NOT to use:**

- Queries that all users can access
- Queries where you want a 403 error to display a paywall (use error handling instead)

**References:**

- `client/hooks/usePantry.ts` — `useExpiringPantryItems(enabled)`
- `client/screens/meal-plan/MealPlanHomeScreen.tsx` — passes `features.pantryTracking`

---

## React Native Patterns

### Multi-Select Checkbox Pattern

For lists where users can select/deselect individual items, use `Set<number>` for O(1) lookup:

```typescript
// State: Track selected indices with Set for efficient lookup
const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());

// Initialize all items as selected when data arrives
useEffect(() => {
  if (items.length > 0) {
    setSelectedItems(new Set(items.map((_, i) => i)));
  }
}, [items.length]); // See "Intentional useEffect Dependencies" pattern

// Toggle with haptic feedback
const toggleItemSelection = (index: number) => {
  haptics.selection();
  setSelectedItems((prev) => {
    const updated = new Set(prev);
    if (updated.has(index)) {
      updated.delete(index);
    } else {
      updated.add(index);
    }
    return updated;
  });
};

// In component - checkbox with accessibility
<Pressable
  onPress={() => toggleItemSelection(index)}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedItems.has(index) }}
  hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }} // 44x44 touch target
>
  <Feather
    name={selectedItems.has(index) ? "check-square" : "square"}
    size={22}
    color={selectedItems.has(index) ? theme.success : theme.textSecondary}
  />
</Pressable>

// Visual dimming for unselected items
<Card style={[styles.card, !isSelected && { opacity: 0.6 }]}>
```

**When to use:** Photo analysis results, batch operations, shopping lists.

### Premium Feature Gating UI

When a feature requires premium, extract the condition and provide clear feedback:

```typescript
// Extract condition to avoid repetition
const isFeatureAvailable = features.someFeature && canUseFeature;

// Button with lock badge and accessibility hint
<Pressable
  onPress={handleFeature}
  accessibilityLabel={
    isFeatureAvailable
      ? "Use premium feature"
      : "Premium feature locked"
  }
  accessibilityHint={
    isFeatureAvailable
      ? undefined
      : "Upgrade to premium to unlock this feature"
  }
>
  <Feather name="star" color={isFeatureAvailable ? theme.text : theme.textSecondary} />
  <ThemedText style={{ color: isFeatureAvailable ? theme.text : theme.textSecondary }}>
    Feature
  </ThemedText>
  {!isFeatureAvailable && (
    <View style={[styles.lockBadge, { backgroundColor: withOpacity(theme.warning, 0.15) }]}>
      <Feather name="lock" size={12} color={theme.warning} />
    </View>
  )}
</Pressable>

// Handler with warning haptic for locked state
const handleFeature = () => {
  if (isFeatureAvailable) {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    // Proceed with feature
  } else {
    haptics.notification(Haptics.NotificationFeedbackType.Warning);
    // Optionally show upgrade prompt
  }
};
```

**Prefer `usePremiumFeature(key)` over raw context access** for checking a single feature flag in a component:

```typescript
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";

// Good: one-liner, boolean result
const canShowMacros = usePremiumFeature("macroGoals");

// Avoid: pulling the full context just to check one flag
const { features } = usePremiumContext();
const canShowMacros = features.macroGoals;
```

Use `usePremiumCamera()` only in camera screens where you need the combined bundle (barcode types, scan limits, quality, etc.).

**Section-level gating — replace content with a lock row:**

When an entire section is premium-only, show the content for premium users and replace it with a compact `Pressable` lock row for free users. The lock row should have full accessibility props and be tappable for a future upgrade modal.

```typescript
// ProfileScreen — NutritionGoalsSection
const canShowMacros = usePremiumFeature("macroGoals");

{canShowMacros ? (
  <>
    <View style={styles.macroGoalRow}>
      {/* Protein progress bar */}
    </View>
    <View style={styles.macroGoalRow}>
      {/* Carbs progress bar */}
    </View>
    <View style={[styles.macroGoalRow, styles.macroGoalRowLast]}>
      {/* Fat progress bar */}
    </View>
  </>
) : (
  <Pressable
    accessible
    accessibilityRole="button"
    accessibilityLabel="Detailed macro tracking requires Premium subscription"
    accessibilityHint="Upgrade to premium to unlock macro goals"
    onPress={() => {
      // TODO: Show upgrade modal
    }}
    style={[styles.macroGoalRow, styles.macroGoalRowLast, styles.premiumLockRow]}
  >
    <Feather name="lock" size={16} color={theme.textSecondary} />
    <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
      Detailed macro tracking available with Premium
    </ThemedText>
  </Pressable>
)}
```

**Key rules for section-level gating:**

- Lock row uses `Pressable`, not `View` — keeps it tappable for upgrade prompts
- Always set `accessible`, `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`
- Use `theme.textSecondary` for lock icon and text (muted, not attention-grabbing)
- Extract lock row layout into a named style (`premiumLockRow`) instead of inline

**Disabled input gating — visible but non-editable:**

When free users should _see_ calculated values but not _edit_ them, render the inputs as disabled with a lock icon overlay. This preserves layout and lets free users understand what premium offers.

```typescript
// GoalSetupScreen — macro goal inputs
const canSetMacros = usePremiumFeature("macroGoals");

<View style={[styles.goalItem, !canSetMacros && { opacity: 0.4 }]}>
  <View>
    <TextInput
      style={[styles.goalInput, { backgroundColor: theme.backgroundSecondary, color: theme.proteinAccent }]}
      value={manualProtein}
      onChangeText={setManualProtein}
      keyboardType="numeric"
      editable={canSetMacros}
      accessibilityLabel={
        canSetMacros
          ? "Daily protein target"
          : "Daily protein target (Premium required)"
      }
    />
    {!canSetMacros && (
      <View style={styles.goalLockIcon}>
        <Feather name="lock" size={12} color={theme.textSecondary} />
      </View>
    )}
  </View>
  <ThemedText type="small" style={{ color: theme.textSecondary }}>
    Protein (g)
  </ThemedText>
</View>
```

**Key rules for disabled input gating:**

- Set `editable={false}` on `TextInput` — prevents keyboard from opening
- Apply `opacity: 0.4` to the wrapper — visually signals "unavailable"
- Position a lock icon absolutely within the input area (`position: "absolute"`, top-right)
- Append "(Premium required)" to `accessibilityLabel` so screen readers announce the restriction
- The calculated server values still save normally — free users get defaults, premium users can override

### Intentional useEffect Dependencies

When you deliberately use a derived value (like `array.length`) instead of the array itself in a useEffect dependency, document WHY to prevent "fixes" that break the intended behavior:

```typescript
// Good: Clear comment explaining the intentional choice
// Initialize all items as selected when foods array populates.
// We intentionally only track foods.length (not the foods array reference) because:
// 1. handleEditFood creates new array references but preserves length
// 2. We only want to reset selections when AI analysis returns NEW foods
// 3. This avoids resetting user's selections when they edit food names
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]);
```

```typescript
// Bad: Suppressing lint without explanation invites "fixes"
useEffect(() => {
  if (foods.length > 0) {
    setSelectedItems(new Set(foods.map((_, i) => i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [foods.length]); // Future dev: "Why not [foods]? Let me fix this..."
```

**Rule:** If you suppress `react-hooks/exhaustive-deps`, always explain WHY in a comment above the useEffect.

### Conditional Pressable Rendering

When building reusable wrapper components that may or may not be interactive, conditionally render as `View` or `Pressable` based on whether `onPress` is provided:

```typescript
// Good: Renders as View when not interactive
export function Card({ children, onPress, style }: CardProps) {
  const content = <>{children}</>;

  if (onPress) {
    return (
      <Pressable onPress={onPress} style={[styles.card, style]}>
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{content}</View>;
}

// Usage - Card passes through touch events to parent
<Pressable onPress={handleNavigate}>
  <Card>  {/* Renders as View, doesn't block touches */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

```typescript
// Bad: Always renders as Pressable
export function Card({ children, onPress, style }: CardProps) {
  return (
    <Pressable onPress={onPress} style={[styles.card, style]}>
      {children}
    </Pressable>
  );
}

// Problem - nested Pressables block touch events
<Pressable onPress={handleNavigate}>  {/* This onPress never fires! */}
  <Card>  {/* Inner Pressable captures and swallows the touch */}
    <Text>Tap me</Text>
  </Card>
</Pressable>
```

**Why:** In React Native, nested `Pressable` components cause the inner one to capture touch events. If the inner `Pressable` has no `onPress` handler, the touch is swallowed and the parent never receives it.

**When to use:** Any reusable component (Card, ListItem, Container) that wraps content and may optionally be tappable.

### Route Params for Mode Toggling

Use route params to toggle between screen modes instead of creating separate screens:

```typescript
// Good: Single screen with mode param (HistoryScreen.tsx)
type HistoryScreenRouteProp = RouteProp<
  { History: { showAll?: boolean } },
  "History"
>;

export default function HistoryScreen() {
  const route = useRoute<HistoryScreenRouteProp>();
  const showAll = route.params?.showAll ?? false;

  // Conditional rendering based on mode
  if (showAll) {
    return <FullHistoryView onBack={() => navigation.setParams({ showAll: false })} />;
  }

  return <DashboardView onViewAll={() => navigation.setParams({ showAll: true })} />;
}
```

```typescript
// Bad: Separate screens for each mode
// HistoryDashboardScreen.tsx
// FullHistoryScreen.tsx
// Duplicates shared logic, state management, and navigation setup
```

**When to use:**

- Dashboard + expanded view (Today dashboard vs full history)
- List view + detail view in same context
- Compact + expanded modes of same data

**Benefits:**

- Shared state and queries (no refetch when switching modes)
- Cleaner navigation stack (back button works naturally)
- Single source of truth for the data

### CompositeNavigationProp for Cross-Stack Navigation

When navigating from one tab stack to a screen in another tab stack, use `CompositeNavigationProp`:

```typescript
import {
  CompositeNavigationProp,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Define the composite type for cross-tab navigation
type HistoryScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;

export default function HistoryScreen() {
  const navigation = useNavigation<HistoryScreenNavigationProp>();

  const handleScanPress = () => {
    // Navigate to ScanTab (different tab stack)
    navigation.navigate("ScanTab");
  };

  const handleItemPress = (itemId: number) => {
    // Navigate within current stack
    navigation.navigate("ItemDetail", { itemId });
  };
}
```

**When to use:**

- Dashboard with "Scan" CTA that navigates to camera tab
- Profile screen navigating to history or settings in other tabs
- Any cross-tab navigation from within a stack

**Why:** Standard `NativeStackNavigationProp` only knows about screens in its own stack. `CompositeNavigationProp` combines the stack navigator's type with the tab navigator's type, enabling type-safe navigation across both.

### Full-Screen Detail with transparentModal

Use `presentation: "transparentModal"` with `slide_from_bottom` animation for full-screen detail views. The screen component fills the entire screen with its own background, close button, and scrollable content. The hero image extends to the very top with no native chrome.

**Key learnings from iOS modal presentations:**

| Presentation                | Background visible            | Native chrome        | Verdict          |
| --------------------------- | ----------------------------- | -------------------- | ---------------- |
| `modal` / `formSheet`       | Yes                           | Grabber bar, detents | Not customizable |
| `containedTransparentModal` | Yes                           | Grabber bar          | Not customizable |
| `fullScreenModal`           | No (detaches previous screen) | None                 | Black background |
| `transparentModal`          | Yes                           | None                 | Use this one     |

**Navigator config:**

```typescript
// RootStackNavigator.tsx
<Stack.Screen
  name="RecipeDetail"
  component={RecipeDetailScreen}
  options={{
    headerShown: false,
    presentation: "transparentModal",
    animation: "slide_from_bottom",
  }}
/>
```

**Screen component:**

```typescript
// RecipeDetailScreen.tsx
export default function RecipeDetailScreen() {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const navigation = useNavigation();
  const dismiss = useCallback(() => navigation.goBack(), [navigation]);

  return (
    <View style={[styles.container, { backgroundColor: theme.backgroundRoot }]}>
      {/* Close button — floats over hero image */}
      <View style={[styles.closeHeader, { top: insets.top + Spacing.xs }]}>
        <Pressable
          onPress={dismiss}
          hitSlop={8}
          style={styles.closeButton}
          accessibilityLabel="Close"
          accessibilityRole="button"
        >
          <Feather name="chevron-down" size={20} color="#fff" />
        </Pressable>
      </View>

      <ScrollView
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
      >
        <Image source={{ uri: imageUri }} style={styles.heroImage} />
        {/* Content below image */}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  closeHeader: {
    position: "absolute",
    right: Spacing.md,
    zIndex: 10,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.4)", // hardcoded
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: "100%",
    height: 250,
  },
});
```

**Critical ScrollView props:** On iOS, ScrollView inside a modal automatically adds content insets for the status bar. Set `contentInsetAdjustmentBehavior="never"` and `automaticallyAdjustContentInsets={false}` to prevent a gap above the hero image.

**When to use:** Detail views, recipe cards, or any screen that slides up over the current content as a full-screen overlay.

**When NOT to use:** Standard modals that benefit from native iOS sheet gestures (drag-to-dismiss detents). Use `presentation: "modal"` or `formSheet` for those.

**Why:** `transparentModal` is the only native-stack presentation that both keeps the previous screen visible (no black/grey background flash) and adds no native chrome (no grabber bars or forced corner radius). The tradeoff is you must handle your own close button and cannot use native swipe-to-dismiss.

### fullScreenModal Exception for Camera

Use `presentation: "fullScreenModal"` instead of `transparentModal` for camera/scan screens. `transparentModal` has rendering issues on iOS that cause visual artifacts, and `fullScreenModal`'s black background is acceptable because the camera feed fills the screen immediately.

```typescript
<Stack.Screen
  name="Scan"
  component={ScanScreen}
  options={{
    headerShown: false,
    // fullScreenModal intentional — transparentModal had rendering issues
    presentation: "fullScreenModal",
    animation: "slide_from_bottom",
  }}
/>
```

**When to use:** Camera screens, barcode scanners, or any full-screen view where the content fills the screen with a dark/opaque background.

**When NOT to use:** Detail views or overlays where the previous screen should remain visible underneath. Use `transparentModal` for those.

**Why:** `transparentModal` is the default recommendation for full-screen overlays, but it has rendering issues that cause visual artifacts on some iOS versions. Camera screens don't benefit from transparency anyway since the camera feed is opaque, so `fullScreenModal` is the better choice.

### FAB Overlay with Tab Bar Clearance

When adding a Floating Action Button (FAB) as a sibling to `Tab.Navigator`, use static layout constants instead of `useBottomTabBarHeight()`. The hook requires Tab.Navigator context and crashes when called from a sibling component.

**Layout constants** (defined in `client/constants/theme.ts`):

```typescript
export const TAB_BAR_HEIGHT = Platform.select({ ios: 88, android: 72 }) ?? 88;
export const FAB_SIZE = 56;
export const FAB_CLEARANCE = FAB_SIZE + 16; // FAB size + gap
```

**FAB positioning** (sibling to Tab.Navigator, not a child):

```typescript
// MainTabNavigator.tsx
<View style={{ flex: 1 }}>
  <Tab.Navigator>{/* tabs */}</Tab.Navigator>
  <ScanFAB />  {/* sibling — cannot use useBottomTabBarHeight() here */}
</View>
```

```typescript
// ScanFAB.tsx — position relative to static tab bar height
<AnimatedPressable
  style={[styles.fab, { bottom: TAB_BAR_HEIGHT + Spacing.lg }]}
>
```

**Content clearance** — every tab screen must add `FAB_CLEARANCE` to its bottom padding so scrollable content isn't obscured:

```typescript
import { FAB_CLEARANCE } from "@/constants/theme";

<ScrollView
  contentContainerStyle={{
    paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
  }}
/>
```

**Critical gotcha:** `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` only works inside components rendered as children of `Tab.Navigator` (tab screens). A FAB rendered as a sibling will crash with "No safe area value available" because the hook depends on Tab.Navigator context that doesn't exist at the sibling level.

**When to use:** Any persistent overlay (FAB, mini-player, banner) positioned above the tab bar but outside the tab navigator's component tree.

**Why:** Static constants are reliable across all component positions. The values must be kept in sync with `Tab.Navigator`'s `tabBarStyle.height` — both reference `TAB_BAR_HEIGHT` from `theme.ts` to ensure a single source of truth.

### Coordinated Pull-to-Refresh for Multiple Queries

When a screen fetches data from multiple endpoints, coordinate refresh with `Promise.all`:

```typescript
const {
  data: summaryData,
  refetch: refetchSummary,
} = useQuery<DailySummaryResponse>({
  queryKey: ["/api/daily-summary"],
});

const {
  data: itemsData,
  refetch: refetchItems,
} = useInfiniteQuery<PaginatedResponse<ScannedItemResponse>>({
  queryKey: ["/api/scanned-items"],
});

const [refreshing, setRefreshing] = useState(false);

const handleRefresh = useCallback(async () => {
  setRefreshing(true);
  try {
    // Refresh all queries in parallel
    await Promise.all([refetchSummary(), refetchItems()]);
  } finally {
    setRefreshing(false);
  }
}, [refetchSummary, refetchItems]);

return (
  <FlatList
    refreshing={refreshing}
    onRefresh={handleRefresh}
    // ...
  />
);
```

**When to use:**

- Dashboard screens with stats + list data
- Profile screens with user info + activity data
- Any screen combining data from multiple API calls

**Why:** Individual `refetch()` calls would cause jarring partial updates. Coordinated refresh ensures the UI updates atomically when all data is ready.

### Safe Area Handling

Always use `useSafeAreaInsets()` for screen layouts:

```typescript
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      }}
    >
      {/* Content */}
    </ScrollView>
  );
}
```

**Why:** Handles iOS notch, Dynamic Island, and home indicator. Adding theme spacing (`Spacing.lg`, `Spacing.xl`) provides visual breathing room beyond the safe area.

### useRef for Synchronous Checks in Callbacks

When a callback needs to check mutable state synchronously (e.g., debouncing, rate limiting), use `useRef` instead of state. State values captured in closures become stale:

```typescript
// Good: useRef for synchronous checks
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);
  const isScanningRef = useRef(false);
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarcodeScanned = useCallback((barcode: string) => {
    // Use ref for synchronous check - always has current value
    if (isScanningRef.current) return;

    isScanningRef.current = true;
    setIsScanning(true);

    // Process barcode...

    // Debounce: reset after delay
    debounceTimeoutRef.current = setTimeout(() => {
      isScanningRef.current = false;
      setIsScanning(false);
    }, 2000);
  }, []); // Empty deps - refs don't need to be dependencies

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, []);

  return { isScanning, handleBarcodeScanned };
}
```

```typescript
// Bad: State check in callback - always stale!
export function useCamera() {
  const [isScanning, setIsScanning] = useState(false);

  const handleBarcodeScanned = useCallback(
    (barcode: string) => {
      // BUG: isScanning is captured at callback creation time
      // It will always be the initial value (false)
      if (isScanning) return; // This never blocks!

      setIsScanning(true);
      // Process barcode... but rapid scans all get through
    },
    [isScanning],
  ); // Adding dependency recreates callback but doesn't fix the issue
}
```

**Why this happens:** `useCallback` creates a closure that captures state values at creation time. Even with dependencies, the check happens against a potentially outdated snapshot.

**When to use:**

- Debouncing rapid events (barcode scans, button clicks)
- Rate limiting (API calls, animations)
- Any callback that needs to check "am I already processing?"

**Pattern:** Keep both `useState` (for UI rendering) and `useRef` (for synchronous logic) when you need both reactive UI updates and reliable synchronous checks.

---

### Haptic Feedback on User Actions

Provide haptic feedback for meaningful interactions:

```typescript
import * as Haptics from "expo-haptics";

// Light impact for navigation/selection
const handleItemPress = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  navigation.navigate("Detail");
};

// Success notification for completed actions
const handleSave = async () => {
  await saveData();
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

// Error notification for failures
const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};
```

**When to use:** Navigation, successful saves, errors, toggle switches, barcode scan success.

**When NOT to use:** Every tap, scrolling, or high-frequency interactions.

### Accessibility Props Pattern

Provide semantic accessibility information for screen readers (VoiceOver on iOS, TalkBack on Android). This is essential for WCAG 2.1 Level AA compliance.

#### Core Accessibility Props

```typescript
// accessibilityLabel: Descriptive text read by screen readers
// accessibilityRole: Semantic role (button, checkbox, radio, text, header, etc.)
// accessibilityState: Current state (selected, checked, disabled, expanded)
// accessibilityHint: Optional hint about what happens when activated

<Pressable
  accessibilityLabel="Add to favorites"
  accessibilityRole="button"
  accessibilityHint="Saves this item to your favorites list"
  onPress={handleAddToFavorites}
>
  <Feather name="heart" size={24} />
</Pressable>
```

#### Checkbox Pattern (Multi-Select Lists)

Use for lists where users can select multiple items (allergies, health conditions):

```typescript
// Good: Combines title and description for context
<Pressable
  onPress={() => toggleSelection(item.id)}
  accessibilityLabel={`${item.name}: ${item.description}`}
  accessibilityRole="checkbox"
  accessibilityState={{ checked: selectedIds.includes(item.id) }}
>
  <Text>{item.name}</Text>
  <Text>{item.description}</Text>
  <Feather name={isSelected ? "check-square" : "square"} />
</Pressable>
```

**Why combine title and description:** Screen reader users hear the full context in one announcement, rather than having to navigate to separate elements.

#### Radio Pattern (Single-Select Lists)

Use for lists where users select exactly one option (diet type, goals):

```typescript
// Good: Uses radio role with selected state
<Pressable
  onPress={() => setSelectedOption(option.id)}
  accessibilityLabel={`${option.name}: ${option.description}`}
  accessibilityRole="radio"
  accessibilityState={{ selected: selectedOption === option.id }}
>
  <Text>{option.name}</Text>
  <Text>{option.description}</Text>
  <View style={[styles.radioOuter, isSelected && styles.radioSelected]}>
    {isSelected && <View style={styles.radioInner} />}
  </View>
</Pressable>
```

**Difference from checkbox:** Use `accessibilityRole="radio"` with `selected` state (not `checked`). This tells screen readers the selection is mutually exclusive.

#### Icon-Only Button Pattern

Icon buttons without visible text MUST have an `accessibilityLabel`:

```typescript
// Good: Descriptive label for icon button
<Pressable
  onPress={() => navigation.goBack()}
  accessibilityLabel="Go back"
  accessibilityRole="button"
>
  <Feather name="arrow-left" size={24} color={colors.text} />
</Pressable>

// Good: Toggle button with state-aware label
<Pressable
  onPress={() => setTorch(!torch)}
  accessibilityLabel={torch ? "Turn off flashlight" : "Turn on flashlight"}
  accessibilityRole="button"
  accessibilityState={{ checked: torch }}
>
  <Feather name={torch ? "zap" : "zap-off"} size={24} />
</Pressable>
```

**Why state-aware labels:** Users know both the current state AND what will happen when they activate the button.

#### Password Visibility Toggle Pattern

```typescript
<Pressable
  onPress={() => setShowPassword(!showPassword)}
  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
  accessibilityRole="button"
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
>
  <Feather name={showPassword ? "eye-off" : "eye"} size={20} />
</Pressable>
```

#### Text Input Pattern

```typescript
<TextInput
  value={username}
  onChangeText={setUsername}
  placeholder="Username"
  accessibilityLabel="Username"
  accessibilityHint="Enter your username to sign in"
  autoCapitalize="none"
  autoCorrect={false}
/>
```

**When to add `accessibilityHint`:** When the purpose isn't obvious from the label alone, or when there are specific requirements (format, length, etc.).

#### List Item Navigation Pattern

For items that navigate to detail screens:

```typescript
// Good: Comprehensive label with action hint
const HistoryItem = React.memo(function HistoryItem({
  item,
  onPress,
}: HistoryItemProps) {
  const calorieText = item.calories ? `${item.calories} calories` : "Calories unknown";

  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityLabel={`${item.productName}${item.brandName ? ` by ${item.brandName}` : ""}, ${calorieText}. Tap to view details.`}
      accessibilityRole="button"
    >
      <Text>{item.productName}</Text>
      <Text>{item.brandName}</Text>
      <Text>{item.calories} cal</Text>
    </Pressable>
  );
});
```

**Why include "Tap to view details":** Informs users that activation will navigate somewhere, not perform an immediate action.

### Touch Target Size Pattern

Ensure interactive elements meet the minimum touch target size of 44x44 points (WCAG 2.1 Level AA requirement):

```typescript
// Good: Element meets minimum size naturally
<Pressable
  style={{ width: 48, height: 48, justifyContent: "center", alignItems: "center" }}
  onPress={handlePress}
>
  <Feather name="settings" size={24} />
</Pressable>

// Good: Small visual element with expanded touch area using hitSlop
<Pressable
  onPress={handlePress}
  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
  accessibilityLabel="Show password"
>
  <Feather name="eye" size={20} />
</Pressable>
```

**When to use `hitSlop`:**

- Icon buttons smaller than 44pt
- Inline interactive elements (password toggle inside input)
- Dense UIs where visual spacing is constrained

**Calculating hitSlop:** If your touchable is 24pt, add hitSlop of 10pt on each side to reach 44pt total: `(24 + 10 + 10) = 44pt`.

### Accessibility Grouping Pattern

Group related elements so screen readers announce them together:

```typescript
// Good: Card announced as single unit
<View
  accessible={true}
  accessibilityLabel={`${productName}, ${brandName}, ${calories} calories. Scanned ${relativeTime}`}
>
  <Text>{productName}</Text>
  <Text>{brandName}</Text>
  <Text>{calories} cal</Text>
  <Text>{relativeTime}</Text>
</View>
```

**When to use `accessible={true}`:**

- Cards or list items with multiple text elements
- Complex components that should be announced as one unit
- When navigating element-by-element would be tedious

**When NOT to use:** When child elements are independently interactive (buttons, links within the group).

### Radio/Checkbox Group Container Pattern

When rendering lists of radio buttons or checkboxes, wrap them in a container with the appropriate group role:

```typescript
// Good: Radio group with accessibilityRole
<View accessibilityRole="radiogroup">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => setSelected(option.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected: selected === option.id }}
    >
      {/* Radio button content */}
    </Pressable>
  ))}
</View>

// Good: Checkbox group (no special container role needed, but can use "list")
<View accessibilityRole="list">
  {OPTIONS.map((option) => (
    <Pressable
      key={option.id}
      onPress={() => toggleOption(option.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selectedIds.includes(option.id) }}
    >
      {/* Checkbox content */}
    </Pressable>
  ))}
</View>
```

**Why:** Screen readers use the `radiogroup` role to understand that only one option can be selected. This provides proper context and navigation behavior for assistive technology users.

**When to use:**

- Single-select option lists (diet type, goals, activity level)
- Any UI where exactly one option must be selected

### Dynamic Accessibility Announcements

Announce important state changes that aren't reflected in focus:

```typescript
import { AccessibilityInfo } from "react-native";

// Announce scan success
const handleBarcodeScanned = async (barcode: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  AccessibilityInfo.announceForAccessibility("Barcode scanned successfully");
  // Process barcode...
};

// Announce errors
const handleError = (message: string) => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility(`Error: ${message}`);
};
```

**When to use:**

- Success/error states after async operations
- Content updates not caused by user navigation
- Timer-based notifications

### useAccessibility Hook Pattern

Centralize accessibility detection with a custom hook that provides reduced motion and screen reader status:

```typescript
// client/hooks/useAccessibility.ts
import { useReducedMotion } from "react-native-reanimated";
import { AccessibilityInfo } from "react-native";
import { useState, useEffect } from "react";

export function useAccessibility() {
  const reducedMotion = useReducedMotion();
  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isScreenReaderEnabled().then(setScreenReaderEnabled);
    const subscription = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    );
    return () => {
      subscription.remove();
    };
  }, []);

  return {
    reducedMotion: reducedMotion ?? false,
    screenReaderEnabled,
  };
}
```

**Why:** Provides a single source of truth for accessibility settings across the app.

**When to use:**

- Components with animations that should respect reduced motion
- Features that behave differently with screen readers
- Any component needing accessibility context

### Accessibility-Aware Haptics Pattern

Wrap haptic feedback to automatically disable when reduced motion is preferred:

```typescript
// client/hooks/useHaptics.ts
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import { useAccessibility } from "./useAccessibility";

export function useHaptics() {
  const { reducedMotion } = useAccessibility();

  const impact = useCallback(
    (
      style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium,
    ) => {
      if (!reducedMotion) {
        Haptics.impactAsync(style);
      }
    },
    [reducedMotion],
  );

  const notification = useCallback(
    (type: Haptics.NotificationFeedbackType) => {
      if (!reducedMotion) {
        Haptics.notificationAsync(type);
      }
    },
    [reducedMotion],
  );

  const selection = useCallback(() => {
    if (!reducedMotion) {
      Haptics.selectionAsync();
    }
  }, [reducedMotion]);

  return { impact, notification, selection, disabled: reducedMotion };
}
```

**Usage:**

```typescript
const haptics = useHaptics();

const handlePress = () => {
  haptics.impact(Haptics.ImpactFeedbackStyle.Light);
  // ... action
};
```

**Why:** Users who enable reduced motion often want reduced sensory feedback overall. This respects that preference while keeping haptic code unchanged.

### Reduced Motion Animation Pattern

Skip or simplify animations when the user has reduced motion enabled:

```typescript
import { useAccessibility } from "@/hooks/useAccessibility";
import Animated, { FadeInDown } from "react-native-reanimated";

function ListItem({ item, index }: { item: Item; index: number }) {
  const { reducedMotion } = useAccessibility();

  // Skip entrance animation when reduced motion is preferred
  const enteringAnimation = reducedMotion
    ? undefined
    : FadeInDown.delay(index * 50).duration(300);

  return (
    <Animated.View entering={enteringAnimation}>
      {/* content */}
    </Animated.View>
  );
}
```

**For press animations:**

```typescript
const handlePressIn = () => {
  if (!reducedMotion) {
    scale.value = withSpring(0.98, pressSpringConfig);
  }
};

const handlePressOut = () => {
  if (!reducedMotion) {
    scale.value = withSpring(1, pressSpringConfig);
  }
};
```

**Why:** WCAG 2.1 requires respecting the "prefers-reduced-motion" setting. This prevents motion sickness and cognitive overload for users who need it.

**For continuous/looping animations:**

Animations that run indefinitely (pulse, shimmer, breathing effects) need a different approach - set a static fallback value instead:

```typescript
const cornerOpacity = useSharedValue(0.6);
const { reducedMotion } = useAccessibility();

useEffect(() => {
  if (reducedMotion) {
    cornerOpacity.value = 0.8; // Static fallback value
    return; // Skip animation setup entirely
  }

  // Only start continuous animation if reduced motion is disabled
  cornerOpacity.value = withRepeat(
    withSequence(
      withTiming(1, { duration: 1000 }),
      withTiming(0.6, { duration: 1000 }),
    ),
    -1, // Infinite repeat
    true, // Reverse direction
  );
}, [reducedMotion]); // Re-run if preference changes
```

**Key differences from entrance/press animations:**

| Animation Type              | Reduced Motion Approach         |
| --------------------------- | ------------------------------- |
| Entrance (`entering` prop)  | Set to `undefined`              |
| Press (scale on tap)        | Skip `withSpring` call          |
| Continuous (pulse, shimmer) | Set static value + early return |

**When to use:** Pulse effects, shimmer loaders, breathing animations, any `withRepeat` with `-1` (infinite).

### Skeleton Loader Pattern

Create reusable skeleton components with shimmer animation and reduced motion support:

```typescript
// client/components/SkeletonLoader.tsx
export function SkeletonBox({ width, height, borderRadius, style }: SkeletonBoxProps) {
  const { theme } = useTheme();
  const { reducedMotion } = useAccessibility();
  const shimmerValue = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      shimmerValue.value = 0.5; // Static opacity for reduced motion
      return;
    }

    shimmerValue.value = withRepeat(
      withTiming(1, { duration: 1200 }),
      -1,
      false,
    );

    return () => cancelAnimation(shimmerValue);
  }, [reducedMotion]);

  const shimmerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmerValue.value, [0, 0.5, 1], [0.3, 0.7, 0.3]),
  }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: theme.backgroundSecondary }, shimmerStyle, style]}
    />
  );
}
```

**Hide skeletons from screen readers:**

```typescript
<FlatList
  ListEmptyComponent={
    isLoading ? (
      <View accessibilityElementsHidden>
        <SkeletonList count={5} />
      </View>
    ) : (
      <EmptyState />
    )
  }
/>
```

**Why:** Screen readers shouldn't announce loading placeholders. `accessibilityElementsHidden` hides the entire subtree from assistive technologies.

### Dynamic Loading State Labels

Update `accessibilityLabel` to reflect loading state for buttons and actions:

```typescript
<Button
  onPress={handleSubmit}
  disabled={isLoading}
  accessibilityLabel={
    isLoading
      ? mode === "login" ? "Signing in" : "Creating account"
      : mode === "login" ? "Sign In" : "Create Account"
  }
>
  {isLoading ? <ActivityIndicator /> : mode === "login" ? "Sign In" : "Create Account"}
</Button>
```

**For loading indicators:**

```typescript
function LoadingFooter() {
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading more items"
    >
      <ActivityIndicator size="small" />
    </View>
  );
}
```

**Why:** Screen reader users need to know when an action is in progress. `accessibilityLiveRegion="polite"` announces the content when it appears without interrupting current speech.

### Query Error Retry Pattern

Provide retry functionality for failed data fetching with accessible controls:

```typescript
const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ["/api/dietary-profile"],
  // ...
});

// In error UI
{isError && (
  <View style={styles.errorContainer}>
    <ThemedText>Failed to load preferences</ThemedText>
    <Pressable
      onPress={() => refetch()}
      accessibilityLabel="Retry loading dietary preferences"
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.retryButton,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather name="refresh-cw" size={14} />
      <ThemedText>Retry</ThemedText>
    </Pressable>
  </View>
)}
```

**Why:** Users should always have a way to recover from transient errors without navigating away. The retry button provides an immediate action rather than requiring a pull-to-refresh or screen reload.

---

## Animation Patterns

### Shared Animation Configuration

Define animation configs in a central location for consistency:

```typescript
// client/constants/animations.ts
import {
  WithSpringConfig,
  WithTimingConfig,
  Easing,
} from "react-native-reanimated";

// Spring configs for press feedback
export const pressSpringConfig: WithSpringConfig = {
  damping: 15,
  stiffness: 150,
};

// Timing configs for expand/collapse animations
export const expandTimingConfig: WithTimingConfig = {
  duration: 300,
  easing: Easing.out(Easing.cubic),
};

export const collapseTimingConfig: WithTimingConfig = {
  duration: 250,
  easing: Easing.in(Easing.cubic),
};

export const contentRevealTimingConfig: WithTimingConfig = {
  duration: 200,
  easing: Easing.out(Easing.cubic),
};
```

**Usage:**

```typescript
import { pressSpringConfig, expandTimingConfig } from "@/constants/animations";

const handlePressIn = () => {
  scale.value = withSpring(0.98, pressSpringConfig);
};

const handleExpand = () => {
  height.value = withTiming(200, expandTimingConfig);
};
```

**Why:** Consistent animation feel across the app. Changing parameters in one place updates all related animations.

### Expandable Card with Lazy-Loaded Content

For cards that expand to show additional content fetched on-demand:

```typescript
type CardState = "collapsed" | "loading" | "expanded";

function ExpandableCard({ itemId }: { itemId: number }) {
  const { reducedMotion } = useAccessibility();
  const [cardState, setCardState] = useState<CardState>("collapsed");
  const animatedHeight = useSharedValue(0);

  // Fetch content only when expanded
  const { data, error } = useQuery({
    queryKey: [`/api/items/${itemId}/details`],
    enabled: cardState === "loading" || cardState === "expanded",
    staleTime: 30 * 60 * 1000, // Cache for 30 minutes
  });

  // Transition to expanded when data arrives
  useEffect(() => {
    if (cardState === "loading" && data) {
      setCardState("expanded");
    }
  }, [cardState, data]);

  // Collapse on error
  useEffect(() => {
    if (cardState === "loading" && error) {
      setCardState("collapsed");
    }
  }, [cardState, error]);

  const handlePress = useCallback(() => {
    if (cardState === "collapsed") {
      setCardState("loading");
      if (!reducedMotion) {
        animatedHeight.value = withTiming(200, expandTimingConfig);
      }
    } else if (cardState === "expanded") {
      setCardState("collapsed");
      if (!reducedMotion) {
        animatedHeight.value = withTiming(0, collapseTimingConfig);
      }
    }
    // Don't toggle while loading
  }, [cardState, reducedMotion, animatedHeight]);

  // ...render with animated height
}
```

**When to use:**

- Cards with "show more" content that requires API fetch
- Recipe/activity suggestions with detailed instructions
- List items that expand to show full details

**Key elements:**

- Three-state machine: `collapsed` → `loading` → `expanded`
- TanStack Query's `enabled` flag for on-demand fetching
- Longer `staleTime` since content is deterministic once generated
- Animated height respecting reduced motion

### Extracted Content for Animation Branches

When the same content appears in both animated and non-animated (reduced motion) code paths, extract it into a separate component to avoid duplication:

```typescript
// Good: Shared content extracted
interface ExpandedContentProps {
  isLoading: boolean;
  data: ContentData | undefined;
  onLayout?: (event: LayoutChangeEvent) => void;
}

function ExpandedContent({ isLoading, data, onLayout }: ExpandedContentProps) {
  if (isLoading) {
    return (
      <View accessibilityLabel="Loading content" accessibilityRole="progressbar">
        <ActivityIndicator />
      </View>
    );
  }

  if (data) {
    return (
      <View onLayout={onLayout}>
        <Text>{data.content}</Text>
      </View>
    );
  }

  return null;
}

// Usage - same content, different wrappers
{reducedMotion ? (
  (isLoading || isExpanded) && (
    <View>
      <ExpandedContent isLoading={isLoading} data={data} onLayout={handleLayout} />
    </View>
  )
) : (
  <Animated.View style={animatedStyle}>
    <ExpandedContent isLoading={isLoading} data={data} onLayout={handleLayout} />
  </Animated.View>
)}
```

```typescript
// Bad: Duplicated content in both branches
{reducedMotion ? (
  (isLoading || isExpanded) && (
    <View>
      {isLoading ? (
        <ActivityIndicator /> // Duplicated
      ) : data ? (
        <Text>{data.content}</Text> // Duplicated
      ) : null}
    </View>
  )
) : (
  <Animated.View style={animatedStyle}>
    {isLoading ? (
      <ActivityIndicator /> // Duplicated
    ) : data ? (
      <Text>{data.content}</Text> // Duplicated
    ) : null}
  </Animated.View>
)}
```

**Why:** Reduces maintenance burden - changes to content structure only need to be made in one place.

**When to use:** Any component with conditional animation that wraps the same content in `Animated.View` vs regular `View`.

---

## Performance Patterns

### Memoize FlatList Components

Use `React.memo` and `useCallback` to prevent unnecessary re-renders in lists:

```typescript
// Memoized list item component
const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  onPress,
}: {
  item: ScannedItemResponse;
  index: number;
  onPress: (item: ScannedItemResponse) => void;
}) {
  // Component implementation
});

// Parent component
export default function HistoryScreen() {
  const navigation = useNavigation();

  // Memoize handler to prevent recreating on every render
  const handleItemPress = useCallback(
    (item: ScannedItemResponse) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      navigation.navigate("ItemDetail", { itemId: item.id });
    },
    [navigation]
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ScannedItemResponse; index: number }) => (
      <HistoryItem item={item} index={index} onPress={handleItemPress} />
    ),
    [handleItemPress]
  );

  return (
    <FlatList
      data={items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id.toString()}
    />
  );
}
```

**Why:** FlatList re-renders items when renderItem function changes. Memoization ensures renders only happen when data changes.

### React.memo for FlatList Header/Footer Components

Extract `ListHeaderComponent` and `ListFooterComponent` as `React.memo` components with typed props instead of inline functions or `useCallback`:

```typescript
// Good: Extract as React.memo with typed props
type DashboardHeaderProps = {
  userName: string;
  currentCalories: number;
  calorieGoal: number;
  onScanPress: () => void;
};

const DashboardHeader = React.memo(function DashboardHeader({
  userName,
  currentCalories,
  calorieGoal,
  onScanPress,
}: DashboardHeaderProps) {
  const { theme } = useTheme();

  return (
    <View>
      <ThemedText>Hello, {userName}</ThemedText>
      <CalorieProgress current={currentCalories} goal={calorieGoal} />
      <Pressable onPress={onScanPress}>
        <ThemedText>Scan Food</ThemedText>
      </Pressable>
    </View>
  );
});

// Usage in parent
<FlatList
  ListHeaderComponent={
    <DashboardHeader
      userName={user?.username ?? ""}
      currentCalories={summary?.totalCalories ?? 0}
      calorieGoal={user?.dailyCalorieGoal ?? 2000}
      onScanPress={handleScanPress}
    />
  }
/>
```

```typescript
// Bad: useCallback for complex header components
const ListHeader = useCallback(() => (
  <View>
    {/* Complex JSX with multiple hooks, theme access, etc. */}
  </View>
), [/* many dependencies */]);

// Bad: Inline function (re-creates on every render)
<FlatList
  ListHeaderComponent={() => <ComplexHeader />}
/>
```

**When to use:**

- Headers/footers with their own hooks (`useTheme`, `useAccessibility`)
- Components with 3+ props from parent state
- Headers/footers with interactive elements (buttons, links)

**Why:**

- `React.memo` prevents re-renders when props are unchanged
- Typed props interface documents the component's data requirements
- Named function provides better stack traces and React DevTools identification
- Cleaner than `useCallback` with many dependencies

### useMemo for Derived Filtering and Calculations

When filtering an array and then calculating derived values (totals, counts), wrap both operations in a single `useMemo` to avoid redundant computation on every render:

```typescript
// Good: Single memoized computation for filter + calculation
const { selectedFoods, totals } = useMemo(() => {
  const selected = foods.filter((_, index) => selectedItems.has(index));
  return {
    selectedFoods: selected,
    totals: calculateTotals(selected),
  };
}, [foods, selectedItems]);

// Usage in render
<ThemedText>({selectedFoods.length} items selected)</ThemedText>
<ThemedText>Total: {totals.calories} cal</ThemedText>
```

```typescript
// Bad: Recomputed on every render
const selectedFoods = foods.filter((_, index) => selectedItems.has(index));
const totals = calculateTotals(selectedFoods);
```

**When to use:**

- Filtering arrays based on selection state
- Computing totals/aggregates from filtered data
- Any derived state used multiple times in render

**When NOT to use:**

- Simple property access (`user.name`)
- Values used only once in render
- Dependencies that change frequently (defeats memoization)

### Cleanup Side Effects in useEffect

Always clean up timeouts, intervals, and subscriptions:

```typescript
// Good: Cleanup prevents memory leaks
useEffect(() => {
  const timer = setTimeout(() => {
    setShowSomething(true);
  }, 2000);

  return () => clearTimeout(timer);
}, []);
```

```typescript
// Bad: Timer continues after component unmounts
useEffect(() => {
  setTimeout(() => {
    setShowSomething(true); // Error if component unmounted
  }, 2000);
}, []);
```

### Avoid Storage Reads in Hot Paths

AsyncStorage operations take 2-10ms. For values read on every API request, use in-memory caching (see above).

### Batch Related Storage Operations

When storing multiple related values, use multiSet/multiRemove:

```typescript
// Good: Single storage operation
await AsyncStorage.multiSet([
  [USER_KEY, JSON.stringify(user)],
  [TOKEN_KEY, token],
]);

// Bad: Multiple operations
await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
await AsyncStorage.setItem(TOKEN_KEY, token);
```

---

## Design System Patterns

### Color Opacity Utility

Use the `withOpacity()` utility function instead of hex string concatenation for color opacity:

```typescript
import { withOpacity } from "@/constants/theme";

// Good: Explicit decimal opacity (0-1 range)
backgroundColor: withOpacity(theme.success, 0.2); // 20% opacity
backgroundColor: withOpacity(theme.link, 0.1); // 10% opacity

// Bad: Magic hex suffix - unclear what opacity "20" represents
backgroundColor: theme.success + "20"; // Is this 20%? (No, it's 12.5%)
backgroundColor: theme.link + "33"; // What opacity is "33"?
```

**Implementation:**

```typescript
// client/constants/theme.ts
export function withOpacity(hexColor: string, opacity: number): string {
  const alpha = Math.round(opacity * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hexColor}${alpha}`;
}
```

**Hex to Opacity Conversion Reference:**

When migrating existing code, use this table to convert hex suffixes to decimal opacity:

| Hex Suffix | Decimal | Actual Opacity | withOpacity() Equivalent    |
| ---------- | ------- | -------------- | --------------------------- |
| `"10"`     | 16      | 6.3%           | `withOpacity(color, 0.06)`  |
| `"15"`     | 21      | 8.2%           | `withOpacity(color, 0.08)`  |
| `"20"`     | 32      | 12.5%          | `withOpacity(color, 0.125)` |
| `"30"`     | 48      | 18.8%          | `withOpacity(color, 0.19)`  |
| `"33"`     | 51      | 20%            | `withOpacity(color, 0.2)`   |
| `"40"`     | 64      | 25%            | `withOpacity(color, 0.25)`  |
| `"80"`     | 128     | 50%            | `withOpacity(color, 0.5)`   |
| `"FF"`     | 255     | 100%           | Just use the color directly |

**When to use:**

- Badge backgrounds with transparency
- Overlay colors
- Disabled state backgrounds
- Any color needing partial opacity

**Why:** The hex suffix approach is confusing because `"20"` in hex is 32 in decimal, which equals 12.5% opacity—not 20%. Using `withOpacity(color, 0.2)` clearly expresses "20% opacity."

### Semantic Theme Values over Hardcoded Colors

Always use theme values instead of hardcoded color strings:

```typescript
import { useTheme } from "@/constants/theme";

const { theme } = useTheme();

// Good: Semantic theme values
color: theme.buttonText; // Instead of "#FFFFFF"
color: theme.text; // Instead of "#000000"
backgroundColor: theme.primary; // Instead of "#00C853"

// Bad: Hardcoded colors bypass theming
color: "#FFFFFF"; // Won't adapt to dark mode
color: "white"; // Same problem
```

**When to use:**

- All text colors
- All background colors
- All border colors
- All icon colors

**Why:**

1. **Dark mode support** - Theme values automatically switch between light/dark
2. **Design consistency** - Central source of truth for colors
3. **Maintainability** - Change colors in one place, not across files
4. **Semantic clarity** - `theme.buttonText` is clearer than `"#FFFFFF"`

**Common mappings:**

| Hardcoded | Theme Value           |
| --------- | --------------------- |
| `#FFFFFF` | `theme.buttonText`    |
| `#000000` | `theme.text`          |
| `#00C853` | `theme.primary`       |
| `#FF6B35` | `theme.calorieAccent` |
| `#F5F5F5` | `theme.background`    |

### Semantic BorderRadius Naming

Add semantic names to `BorderRadius` instead of using calculations:

```typescript
// Good: Semantic name in theme
import { BorderRadius } from "@/constants/theme";

borderRadius: BorderRadius.chipFilled; // 19 - clear intent

// Bad: Magic number calculation
borderRadius: BorderRadius.chip - 9; // Why 9? What does this mean?
borderRadius: 19; // Magic number, no context
```

**Adding new semantic values:**

```typescript
// client/constants/theme.ts
export const BorderRadius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
  // Component-specific values from Figma
  card: 16,
  button: 12,
  chip: 28,
  chipFilled: 19, // Add semantic names for specific use cases
  input: 8,
  badge: 12,
};
```

**When to add a new semantic value:**

- Value comes from Figma design specs
- Same radius used in multiple places
- Calculation would otherwise be needed (`chip - 9`)
- Value has specific component meaning

**Why:**

1. **Self-documenting** - `chipFilled` explains what it's for
2. **Single source of truth** - Change once, updates everywhere
3. **Figma alignment** - Names can match Figma component names
4. **No magic numbers** - Calculations like `chip - 9` hide intent

---

## Documentation Patterns

### Todo Structure

All todos in `todos/` follow the template in `todos/TEMPLATE.md`:

```yaml
---
title: "Brief descriptive title"
status: backlog | planned | in-progress | blocked | review | done
priority: critical | high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
---
```

### Design Decisions Table

Document key architectural choices with rationale:

```markdown
## Design Decisions

| Decision     | Choice              | Rationale                   |
| ------------ | ------------------- | --------------------------- |
| Token type   | Single access token | No refresh token complexity |
| Token expiry | 30 days             | Balances security with UX   |
```

### Files to Modify Table

List all files affected by a change:

```markdown
## Files to Modify

| File                   | Action                      |
| ---------------------- | --------------------------- |
| `shared/types/auth.ts` | Create - type definitions   |
| `server/routes.ts`     | Modify - use new middleware |
```

### Implementation Patterns in Todos

Include copy-paste ready code examples in todos for complex changes. This ensures:

- Consistent implementation
- Faster development
- Built-in code review

### Bottom-Sheet Lifecycle State Machine

Use a ref-based state machine to prevent race conditions when a screen has bottom sheets and async save operations. The ref (not state) is correct here since transitions are synchronous guards, not rendering triggers.

**When to use:** Any screen with `BottomSheetModal` that also has save/submit actions.

**When NOT to use:** Simple modals with no async operations.

```typescript
import { useRef } from "react";
import type { SheetLifecycleState } from "@/components/recipe-builder/types";

// "IDLE" = no sheet open, can open or save
// "SHEET_OPEN" = sheet is presented, block save and other sheets
// "SAVING" = mutation in flight, block everything
const sheetState = useRef<SheetLifecycleState>("IDLE");

const openSheet = (section: SheetSection) => {
  if (sheetState.current !== "IDLE") return; // gate
  sheetState.current = "SHEET_OPEN";
  // ... present sheet
};

const handleSheetDismiss = () => {
  sheetState.current = "IDLE";
};

const handleSave = async () => {
  if (sheetState.current !== "IDLE") return; // gate
  sheetState.current = "SAVING";
  try {
    await mutation.mutateAsync(payload);
  } catch {
    sheetState.current = "IDLE"; // reset on failure
  }
};
```

### Keyboard-to-Sheet Sequencing

Dismiss the keyboard and wait for animations to settle before presenting a bottom sheet. Without this, the keyboard dismiss and sheet present animations collide on iOS, causing visual glitches or the sheet opening behind the keyboard.

**When to use:** Any screen where a `TextInput` might have focus when the user taps to open a `BottomSheetModal`.

**When NOT to use:** Sheets that don't coexist with text inputs.

```typescript
import { Keyboard, InteractionManager } from "react-native";

const openSheet = (section: SheetSection) => {
  Keyboard.dismiss();
  InteractionManager.runAfterInteractions(() => {
    sheetRefs[section].current?.present();
  });
};
```

### Lazy Modal Mounting

Defer mounting heavy modal/sheet components until the user first opens them. Use a `Set` in state to track which modals have been requested, then conditionally render.

**When to use:** Screens with 3+ `BottomSheetModal` or heavy modal components that most users won't all open.

**When NOT to use:** Single-modal screens or modals that must be ready immediately.

```typescript
const [mountedSheets, setMountedSheets] = React.useState<Set<SheetSection>>(
  new Set(),
);

const openSheet = (section: SheetSection) => {
  setMountedSheets((prev) => {
    if (prev.has(section)) return prev; // avoid unnecessary re-render
    const next = new Set(prev);
    next.add(section);
    return next;
  });
  // ... then present
};

// In JSX — sheet only enters tree on first open, stays mounted after
{mountedSheets.has("ingredients") && (
  <BottomSheetModal ref={ingredientsRef} ...>
    <IngredientsSheet />
  </BottomSheetModal>
)}
```

### Module-Level Key Counters for Dynamic Lists

Use module-level counters to generate stable, globally unique keys for dynamic form list items (ingredients, steps, etc.). Avoids React's index-as-key anti-pattern, timestamp collisions, and key reuse across component re-mounts.

**When to use:** Any form with a dynamic list where items can be added, removed, or reordered — especially when items contain `TextInput` that would lose focus on re-key.

**When NOT to use:** Static lists or lists with server-assigned IDs.

```typescript
// client/hooks/useRecipeForm.ts

// Module-level — persists across mounts, ensures globally unique keys
let ingredientKeyCounter = 0;
function nextIngredientKey() {
  return `ing_${++ingredientKeyCounter}`;
}

// Usage in hook
const addIngredient = useCallback(() => {
  setIngredients((prev) => [...prev, { key: nextIngredientKey(), text: "" }]);
}, []);

// Prefill also uses the counter to avoid collisions
function buildIngredientsFromPrefill(
  prefill?: ImportedRecipeData,
): IngredientRow[] {
  if (prefill?.ingredients?.length) {
    return prefill.ingredients.map((ing) => ({
      key: nextIngredientKey(),
      text: [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" "),
    }));
  }
  return [{ key: nextIngredientKey(), text: "" }];
}
```

### Unsaved Changes Navigation Guard

Use React Navigation's `beforeRemove` listener to block navigation when a form has unsaved changes. Also block navigation while a save mutation is in flight to prevent double-submits or data loss.

**When to use:** Any form screen with a save/submit action where accidental back-navigation would lose user input.

**When NOT to use:** Read-only screens or screens where state is already synced to the server in real time.

```typescript
// client/screens/meal-plan/RecipeCreateScreen.tsx

useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    // Block navigation during save
    if (createMutation.isPending) {
      e.preventDefault();
      return;
    }

    // Allow navigation if form is clean
    if (!form.isDirty) return;

    // Prompt for unsaved changes
    e.preventDefault();
    Alert.alert("Discard changes?", "You have unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(e.data.action),
      },
    ]);
  });

  return unsubscribe;
}, [navigation, form.isDirty, createMutation.isPending]);
```

**Key details:**

- `isPending` check prevents back-swipe during save, avoiding partial writes
- `isDirty` comes from the form hook (see below), not manual tracking
- Both values must be in the dependency array so the listener re-binds when they change

### Form State Hook with Summaries and isDirty

Extract multi-section form state into a custom hook that provides: state + setters, CRUD actions for dynamic lists, `useMemo`-derived summaries for display, a single `isDirty` flag, and a `formToPayload()` serializer. This keeps the screen component focused on layout and navigation.

**When to use:** Forms with 3+ distinct sections, especially with dynamic lists and a summary/preview UI.

**When NOT to use:** Simple single-field forms or forms where TanStack Form or React Hook Form is already in use.

```typescript
// client/hooks/useRecipeForm.ts

export function useRecipeForm(prefill?: ImportedRecipeData) {
  const [title, setTitle] = useState(prefill?.title || "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    buildIngredientsFromPrefill(prefill),
  );
  // ... more sections

  // Computed summary for section row display
  const ingredientsSummary = useMemo(() => {
    const filled = ingredients.filter((i) => i.text.trim());
    return filled.length > 0
      ? `${filled.length} ingredient${filled.length !== 1 ? "s" : ""}`
      : undefined;
  }, [ingredients]);

  // Single dirty flag across all sections
  const isDirty = useMemo(() => {
    if (title.trim()) return true;
    if (ingredients.some((i) => i.text.trim())) return true;
    // ... check all sections
    return false;
  }, [title, ingredients /* ... all sections */]);

  // Serialize to API payload — filters empty rows, parses text to structured data
  const formToPayload = useCallback(() => {
    const validIngredients = ingredients
      .filter((i) => i.text.trim())
      .map((i) => {
        const parsed = parseIngredientText(i.text.trim());
        return {
          name: parsed.name,
          quantity: parsed.quantity,
          unit: parsed.unit,
        };
      });

    return {
      title: title.trim(),
      ingredients: validIngredients,
      instructions:
        serializeSteps(steps.filter((s) => s.text.trim()).map((s) => s.text)) ||
        null,
      // ... other fields
    };
  }, [title, ingredients, steps /* ... */]);

  return {
    title,
    setTitle,
    ingredients,
    addIngredient,
    removeIngredient,
    updateIngredient,
    ingredientsSummary,
    isDirty,
    formToPayload,
    // ... rest
  };
}
```

**Key details:**

- Summaries update automatically via `useMemo` — no manual "refresh" needed
- `isDirty` checks all sections, not just the one being edited
- `formToPayload()` handles the text → structured data transformation (e.g., "200g chicken" → `{ name: "chicken", quantity: 200, unit: "g" }`)
- Accepts optional `prefill` for hydrating from imports or edits

### Auto-Dismiss Snackbar with useRef Timer

For ephemeral UI prompts (snackbar notifications, toast messages) that should auto-dismiss after a timeout, use `useRef` for the timer ID and `useEffect` cleanup to prevent memory leaks on unmount.

```typescript
const [snackbarItem, setSnackbarItem] = useState<Item | null>(null);

// Use useRef for timer — pass `undefined` as initial value (React 19 requires it)
const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

useEffect(() => {
  if (snackbarItem) {
    dismissTimerRef.current = setTimeout(() => {
      setSnackbarItem(null);
    }, 5000);
  }
  // Cleanup: clear timer on unmount or when snackbarItem changes
  return () => clearTimeout(dismissTimerRef.current);
}, [snackbarItem]);

// Trigger snackbar from an action callback
const handleItemChecked = useCallback((item: Item) => {
  // Show snackbar prompt
  setSnackbarItem(item);
}, []);

// Manual dismiss
const handleDismiss = useCallback(() => {
  setSnackbarItem(null);
}, []);
```

**When to use:**

- Snackbar/toast prompts that appear after a user action and auto-dismiss
- Any ephemeral UI that needs a timeout with proper cleanup

**When NOT to use:**

- Persistent notifications that require explicit user dismissal
- Alert dialogs that block interaction

**Key details:**

1. **`useRef` for timer ID** — avoids stale closure issues and survives re-renders
2. **`useEffect` cleanup** — clears the timer if the component unmounts or the trigger item changes before the timeout fires
3. **React 19 requires explicit initial value** — `useRef<T>()` without an argument causes a TypeScript error; pass `undefined`
4. **null state = hidden** — render the snackbar conditionally: `{snackbarItem && <Snackbar ... />}`

**References:**

- `client/screens/meal-plan/GroceryListScreen.tsx` — pantry prompt snackbar with auto-dismiss
- Related learning: "React 19 useRef Requires Initial Value" in LEARNINGS.md

---

## External API Parsing Patterns

### ISO 8601 Duration Parsing

Parse ISO 8601 duration strings (from schema.org recipes, calendar events, etc.) into numeric minutes for storage and display. Return `null` for missing or unparseable values instead of throwing.

**When to use:** Importing data from schema.org structured data, iCal/ICS feeds, or any external source using ISO 8601 durations (e.g., `PT1H30M`, `PT15M`).

**When NOT to use:** Internal data that already stores durations as numbers.

```typescript
// server/services/recipe-import.ts

export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return hours * 60 + minutes;
}

// Usage
parseIsoDuration("PT1H30M"); // → 90
parseIsoDuration("PT15M"); // → 15
parseIsoDuration("PT2H"); // → 120
parseIsoDuration(undefined); // → null
parseIsoDuration("invalid"); // → null
```

**Key details:**

- Case-insensitive (`/i` flag) to handle mixed-case from external sources
- Seconds component is parsed but not added to the result (recipes don't need second-level precision)
- Returns `null` (not 0 or throws) for graceful handling in optional fields

### Intent-Driven Config Object

Place a shared config record in `shared/constants/` keyed by intent/mode union type. Both client and server import the same object to drive branching behavior:

```typescript
// shared/constants/preparation.ts
export const INTENT_CONFIG: Record<
  PhotoIntent,
  {
    needsNutrition: boolean;
    needsSession: boolean;
    canLog: boolean;
    label: string;
  }
> = {
  log: { needsNutrition: true, needsSession: true, canLog: true, label: "Log this meal" },
  identify: { needsNutrition: false, needsSession: false, canLog: false, label: "Just identify" },
  // ...
};

// Server usage — drives which steps to execute
const intentConfig = INTENT_CONFIG[intent];
if (intentConfig.needsNutrition) {
  foods = await batchNutritionLookup(result.foods);
}
if (intentConfig.needsSession) {
  sessionStore.set(sessionId, { userId, result, createdAt: new Date() });
}

// Client usage — drives which UI to render
const config = INTENT_CONFIG[intent];
{config.canLog && <LogButton onPress={handleConfirm} />}
```

**When to use:** Multiple code paths share the same feature with mode-dependent behavior (photo intents, notification types, export formats).

**When NOT to use:** Only 2 simple modes with a boolean flag — a simple `if` is clearer.

**Why:** Eliminates scattered `if (intent === "log")` checks across client and server. Adding a new intent means adding one config entry instead of hunting for conditionals.

### Compress-Upload-Cleanup for Image Uploads

When uploading user images, always compress before upload and clean up the temporary file afterward using `try/finally`:

```typescript
// client/lib/photo-upload.ts
import { compressImage, cleanupImage } from "./image-compression";
import { uploadAsync, FileSystemUploadType } from "expo-file-system/legacy";

export async function uploadPhotoForAnalysis(
  uri: string,
  intent: PhotoIntent = "log",
): Promise<PhotoAnalysisResponse> {
  const compressed = await compressImage(uri);

  try {
    const uploadResult = await uploadAsync(
      `${getApiUrl()}/api/photos/analyze`,
      compressed.uri,
      {
        httpMethod: "POST",
        uploadType: FileSystemUploadType.MULTIPART,
        fieldName: "photo",
        parameters: { intent },
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    return JSON.parse(uploadResult.body) as PhotoAnalysisResponse;
  } finally {
    await cleanupImage(compressed.uri); // Always runs, even on error
  }
}
```

The compression step (`client/lib/image-compression.ts`) uses adaptive quality reduction — if the first pass exceeds the target size, it recalculates quality proportionally:

```typescript
if (sizeKB > targetSizeKB && quality > 0.3) {
  const newQuality = Math.max(0.3, quality * (targetSizeKB / sizeKB));
  result = await manipulateAsync(uri, [{ resize }], { compress: newQuality });
}
```

**When to use:** Any image upload from the client (photo analysis, profile avatars).

**When NOT to use:** Small files like icons or thumbnails that don't need compression.

**Why:** Reduces upload payload (1024px max, JPEG quality 0.7, <1MB target), prevents temp file buildup on device, and `finally` guarantees cleanup even if the upload fails.

### Confidence-Based Follow-Up Refinement

When AI analysis produces low-confidence results, prompt the user for clarification and re-analyze with the additional context:

```typescript
// Server: check if follow-up is needed
const CONFIDENCE_THRESHOLD = 0.7;

export function needsFollowUp(result: AnalysisResult): boolean {
  return (
    result.overallConfidence < CONFIDENCE_THRESHOLD ||
    result.followUpQuestions.length > 0 ||
    result.foods.some((f) => f.needsClarification)
  );
}

// Server: refine with user's answer (text-only, no image re-send)
export async function refineAnalysis(
  previousResult: AnalysisResult,
  question: string,
  answer: string,
): Promise<AnalysisResult> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Previous analysis: ${JSON.stringify(previousResult)}\nRefine based on user answer.`,
      },
      { role: "user", content: `Q: ${question}\nA: ${answer}` },
    ],
    response_format: { type: "json_object" },
  });
  return analysisResultSchema.parse(
    JSON.parse(response.choices[0]?.message?.content || "{}"),
  );
}

// Client: show follow-up UI conditionally
if (analysisResult.needsFollowUp) {
  setShowFollowUp(true); // Renders question + answer input
}
```

**When to use:** Any AI analysis where confidence scoring is available and user clarification can improve accuracy.

**When NOT to use:** Deterministic lookups (barcode scans, database queries) where results are either correct or not found.

**Why:** Low-confidence results displayed without refinement erode user trust. The follow-up is text-only (no image re-send), so it's cheap and fast. The threshold (0.7) is tunable — lower values reduce prompts but risk showing inaccurate data.

### Zod Union + Transform for LLM Output Flexibility

LLMs may return a field as either a string or an array of strings depending on prompt interpretation. Use `z.union` with `.transform` to normalize the shape, then `.pipe` to validate the final type.

```typescript
// server/services/recipe-generation.ts

const recipeContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  difficulty: z.enum(["Easy", "Medium", "Hard"]),
  timeEstimate: z.string().min(1).max(50),
  // LLMs sometimes return instructions as ["Step 1...", "Step 2..."]
  // instead of a single string. Accept both, normalize to string.
  instructions: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v.join("\n") : v))
    .pipe(z.string().min(1)),
  dietTags: z.array(z.string()).default([]),
});

// Usage with safeParse
const content = response.choices[0]?.message?.content || "{}";
const parsed = recipeContentSchema.safeParse(JSON.parse(content));

if (!parsed.success) {
  console.error("Recipe generation validation failed:", parsed.error);
  throw new Error("Failed to generate valid recipe content");
}

return parsed.data; // instructions is always a string
```

**When to use:** Parsing LLM JSON responses where the prompt asks for a specific type but the model sometimes returns a different-but-coercible type (string vs array, number vs string-encoded number).

**When NOT to use:** Deterministic APIs with stable schemas. Use plain Zod schemas or `z.coerce` for simple type coercion (e.g., `z.coerce.number()` for string-to-number).

**Why:** LLM output is inherently unpredictable — even with `response_format: { type: "json_object" }`, the structure of individual fields can vary between calls. The `union` + `transform` + `pipe` chain handles this at the validation layer without requiring prompt engineering workarounds. The `.pipe()` step ensures the transformed value still passes final validation (e.g., `min(1)` catches empty arrays that would transform to `""`).

---

## Testing Patterns

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
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv }; // Restore original env
  });

  it("auto-approves in development", async () => {
    process.env.NODE_ENV = "development";

    vi.resetModules(); // Clear Vitest's module cache
    const { validateReceipt } = await import("../receipt-validation"); // Fresh import

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(true);
  });

  it("rejects in production", async () => {
    process.env.NODE_ENV = "production";

    vi.resetModules();
    const { validateReceipt } = await import("../receipt-validation");

    const result = await validateReceipt("fake-receipt", "ios");
    expect(result.valid).toBe(false);
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

---

## Adding New Patterns

When you establish a new pattern:

1. Use it in your implementation
2. Document it here with:
   - What the pattern is
   - When to use it
   - When NOT to use it
   - Code example
3. Reference this doc in your todo/PR
