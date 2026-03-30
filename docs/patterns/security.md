# Security Patterns

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

#### Storage-Layer Defense-in-Depth

Route-level ownership checks are the primary defense, but storage mutation methods that operate on user-owned resources should also include `userId` in their WHERE clause. This prevents IDOR if a storage method is called from a different code path that forgets the ownership check.

**When to use:** Any `IStorage` method that updates or deletes a row in a user-owned table by primary key (`id`).

**When NOT to use:** Methods that operate on non-user-scoped resources (e.g., shared recipe catalog). For read-only methods on junction/child tables without a `userId` column, see [Junction Table Reads](#junction-table-reads-innerjoin-through-parent-for-ownership) below.

**Implementation:**

```typescript
// ❌ Bad: Storage method trusts the caller to pass the right ID
async endFastingLog(id: number, ...): Promise<FastingLog | undefined> {
  const [updated] = await db.update(fastingLogs)
    .set({ ... })
    .where(eq(fastingLogs.id, id))  // No userId check!
    .returning();
  return updated || undefined;
}

// ✅ Good: Storage method enforces ownership itself
async endFastingLog(id: number, userId: string, ...): Promise<FastingLog | undefined> {
  const [updated] = await db.update(fastingLogs)
    .set({ ... })
    .where(and(eq(fastingLogs.id, id), eq(fastingLogs.userId, userId)))
    .returning();
  return updated || undefined;
}
```

**Rationale:** A route may look safe because it first looks up the active record by `userId` and then passes the `id` to the storage mutation. But if a future code path calls the mutation directly with an untrusted `id`, the missing `userId` filter becomes an IDOR vulnerability. Adding `userId` to the WHERE clause makes the storage layer independently safe regardless of how it is called. The cost is one extra parameter; the benefit is defense-in-depth against authorization bypass.

**References:**

- `server/storage.ts` — `endFastingLog`, `deleteMenuScan`, `deleteMedicationLog`, `softDeleteScannedItem`
- Related learning: "IDOR in Micronutrients and Chat Routes" in LEARNINGS.md
- See also: [IDOR Protection: Auth + Ownership Check](#idor-protection-auth--ownership-check)

#### Junction Table Reads: innerJoin Through Parent for Ownership

When reading from a junction or child table that has **no `userId` column** (ownership is only on the parent), use `innerJoin` through the parent table and include `eq(parent.userId, userId)` in the WHERE clause. This extends the defense-in-depth principle to read methods on indirectly-owned data.

**When to use:** Any read from a child/junction table where the child row's ownership is determined by its parent (cookbook recipes, grocery list items, recipe ingredients).

**When NOT to use:** Child tables that have their own `userId` column — filter directly on the child.

**Implementation:**

```typescript
// ❌ Bad: Junction table read with no ownership check
export async function getCookbookRecipes(
  cookbookId: number,
): Promise<CookbookRecipe[]> {
  return db
    .select()
    .from(cookbookRecipes)
    .where(eq(cookbookRecipes.cookbookId, cookbookId)) // Any user's cookbookId works!
    .orderBy(desc(cookbookRecipes.addedAt));
}

// ✅ Good: Join through parent to verify ownership
export async function getCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<CookbookRecipe[]> {
  const rows = await db
    .select({ recipe: cookbookRecipes })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbooks.userId, userId), // Ownership enforced via parent
      ),
    )
    .orderBy(desc(cookbookRecipes.addedAt));
  return rows.map((r) => r.recipe);
}
```

**Rationale:** A route calling this function may verify ownership separately (e.g., `getCookbook(id, userId)` before `getCookbookRecipes(id)`). But if a future code path calls the read function directly with an untrusted `cookbookId`, it would leak another user's data. The `innerJoin` approach makes the storage function independently safe with minimal overhead — the join uses the parent's primary key index.

**References:**

- `server/storage/cookbooks.ts` — `getCookbookRecipes(cookbookId, userId)`
- See also: [Storage-Layer Defense-in-Depth](#storage-layer-defense-in-depth) (the parent pattern for direct-owned tables)

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

Use origin pattern matching instead of wildcard `*` for CORS. Never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` — browsers reject this combination, and it signals an intent error. Only set CORS headers for allowed origins:

```typescript
// ✅ GOOD: Only reflect specific origins; keep all CORS headers inside the allowed block
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ❌ BAD: Wildcard with credentials; leaks methods/headers to disallowed origins
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*"); // "*" + credentials = broken
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // These leak to ALL origins, even disallowed ones:
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
```

**Rules:**

1. **No-origin requests** (mobile apps, curl): omit CORS headers entirely — they don't need them
2. **Allowed origins**: reflect the specific `origin` value, set credentials + methods + headers
3. **Disallowed origins**: send no CORS headers at all — don't leak allowed methods/headers
4. **`isAllowedOrigin`** should use exact match or anchored regex patterns, not `.includes()`

**Reference:** `server/index.ts`

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

Track timeout references and per-user counts to prevent memory leaks:

```typescript
const sessionStore = new Map<string, AnalysisSession>();
const sessionTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const userSessionCount = new Map<string, number>();

const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Clear session, its timeout, and decrement user count.
 * Call this whenever a session is deleted to prevent memory leaks.
 */
function clearSession(sessionId: string): void {
  const session = sessionStore.get(sessionId);
  const existingTimeout = sessionTimeouts.get(sessionId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
    sessionTimeouts.delete(sessionId);
  }
  sessionStore.delete(sessionId);
  if (session) {
    decrementUserCount(session.userId);
  }
}

// When creating session:
const timeoutId = setTimeout(() => {
  clearSession(sessionId); // Always use clearSession — never delete manually
}, SESSION_TIMEOUT);
sessionTimeouts.set(sessionId, timeoutId);

// When session is accessed/confirmed:
clearSession(sessionId);
```

**Why:** Orphaned timeouts consume memory and may reference stale data. Always route deletion through `clearSession()` so per-user counts stay consistent.

### Test Internals Export Pattern

Export internal module state for testing via a `_testInternals` object:

```typescript
// Prefix with underscore to signal non-public API
export const _testInternals = {
  analysisSessionStore,
  userSessionCount,
  MAX_SESSIONS_PER_USER,
  clearSession,
};
```

```typescript
// In tests:
import { _testInternals } from "../photos";

beforeEach(() => {
  _testInternals.analysisSessionStore.clear();
  _testInternals.userSessionCount.clear();
});
```

**Why:** Allows tests to manipulate internal state (pre-fill maps, verify cleanup) without exposing implementation details in the public API. The underscore prefix convention signals this is not for production consumers.

### Bounded In-Memory Store Pattern

When holding per-user state in a `Map`, enforce per-user caps, a global cap, and size validation to prevent memory exhaustion:

```typescript
const MAX_SESSIONS_PER_USER = 3;
const MAX_SESSIONS_GLOBAL = 1000;
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

// Check raw buffer size — NOT base64 string length (which is ~33% larger)
if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) {
  return sendError(res, 413, "Image too large", "IMAGE_TOO_LARGE");
}
if (sessionStore.size >= MAX_SESSIONS_GLOBAL) {
  return sendError(res, 429, "Server busy", "SESSION_LIMIT_REACHED");
}
if ((userSessionCount.get(userId) ?? 0) >= MAX_SESSIONS_PER_USER) {
  return sendError(res, 429, "Too many sessions", "USER_SESSION_LIMIT");
}
```

**Why:** An unbounded `Map` holding base64 images (~1-4 MB each) can exhaust server memory. Always cap per-user and global counts, and validate payload size before storing.

### Early Rejection Before Paid APIs

Place cheap validation (size checks, cap limits, permission gates) **before** expensive external calls (OpenAI Vision, nutrition APIs, Spoonacular):

```typescript
// ✅ GOOD — reject before calling paid API
if (intentConfig.needsSession) {
  if (req.file.buffer.length > MAX_IMAGE_SIZE_BYTES) return sendError(...);
  if (sessionStore.size >= MAX_SESSIONS_GLOBAL) return sendError(...);
}
const analysisResult = await analyzePhoto(imageBase64, intent); // expensive

// ❌ BAD — wastes API credits on requests that will be rejected
const analysisResult = await analyzePhoto(imageBase64, intent); // expensive
if (sessionStore.size >= MAX_SESSIONS_GLOBAL) return sendError(...);
```

**Why:** Saves API credits and reduces latency for requests that would be rejected anyway. Validate everything you can locally before incurring external costs.

### Controllable Mock via `vi.hoisted`

Use `vi.hoisted` to create a mutable reference that a `vi.mock` factory can read, enabling per-test overrides:

```typescript
const { mockFileBuffer } = vi.hoisted(() => ({
  mockFileBuffer: { current: Buffer.from("fake-image") },
}));

vi.mock("multer", () => {
  const multerMock = () => ({
    single: () => (req, _res, next) => {
      req.file = { buffer: mockFileBuffer.current } as Express.Multer.File;
      next();
    },
  });
  multerMock.memoryStorage = () => ({});
  return { default: multerMock };
});

// In a specific test:
it("rejects oversized images", async () => {
  const original = mockFileBuffer.current;
  mockFileBuffer.current = Buffer.alloc(6 * 1024 * 1024);
  try {
    // ... test logic
  } finally {
    mockFileBuffer.current = original;
  }
});
```

**Why:** `vi.mock` factories are hoisted and run once, so they can't reference test-local variables. Wrapping the value in a `{ current }` ref object via `vi.hoisted` gives tests a stable reference they can mutate per-test while the mock reads the latest value.

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

### Token Versioning for JWT Revocation

Embed a `tokenVersion` counter in JWT payloads. On logout (or password change), increment the counter in the database. The auth middleware compares the token's version against the DB value -- a mismatch means the token has been revoked. Combined with the in-memory TTL cache (see [In-Memory TTL Cache for Per-Request DB Avoidance](#in-memory-ttl-cache-for-per-request-db-avoidance) in Performance Patterns), this achieves near-instant revocation with minimal DB overhead.

```typescript
// shared/types/auth.ts — token payload shape
export interface AccessTokenPayload {
  sub: string;
  tokenVersion: number;
}

// server/routes/auth.ts — generate token with version
import { generateToken } from "../middleware/auth";

const token = generateToken(user.id, user.tokenVersion);

// server/routes/auth.ts — logout: bump version + invalidate cache
app.post("/api/auth/logout", requireAuth, async (req, res) => {
  await storage.updateUser(req.userId!, {
    tokenVersion: sql`${users.tokenVersion} + 1`,
  });
  invalidateTokenVersionCache(req.userId!);
  res.json({ message: "Logged out" });
});

// server/middleware/auth.ts — verify version on every request
const payload = jwt.verify(token, jwtSecret);
if (!isAccessTokenPayload(payload)) {
  /* 401 */
}

const cachedVersion = getCachedTokenVersion(payload.sub);
if (cachedVersion !== undefined) {
  if (payload.tokenVersion !== cachedVersion) {
    return res
      .status(401)
      .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
  }
} else {
  const user = await storage.getUser(payload.sub);
  setCachedTokenVersion(payload.sub, user.tokenVersion);
  if (payload.tokenVersion !== user.tokenVersion) {
    return res
      .status(401)
      .json({ error: "Token has been revoked", code: "TOKEN_REVOKED" });
  }
}
```

**When to use:**

- Any system using stateless JWTs that needs server-side revocation (logout, password reset, account compromise)
- When you cannot rely on short token expiry alone for security

**When NOT to use:**

- Systems with session stores (revocation is already built in)
- Short-lived tokens (< 5 minutes) where expiry is sufficient

**Rationale:** JWTs are stateless by design, so there is no built-in "revoke" mechanism. Token versioning adds a lightweight state check that only hits the DB once per cache TTL window. The tradeoff is a maximum `CACHE_TTL_MS` delay between logout and token rejection on other devices.

**References:**

- `server/middleware/auth.ts` -- `requireAuth`, `invalidateTokenVersionCache`, in-memory cache
- `server/routes/auth.ts` -- logout handler that bumps `tokenVersion`
- `shared/types/auth.ts` -- `AccessTokenPayload` interface and `isAccessTokenPayload` type guard
- `shared/schema.ts` -- `tokenVersion` column on the `users` table

### AI Input Sanitization Boundary

All user text that reaches an LLM passes through a three-layer safety boundary: input sanitization, system prompt boundary markers, and output validation.

```typescript
import {
  sanitizeUserInput,
  validateAiResponse,
  SYSTEM_PROMPT_BOUNDARY,
  containsDangerousDietaryAdvice,
} from "../lib/ai-safety";

// 1. Sanitize user input — strip control chars and injection patterns
const cleanInput = sanitizeUserInput(userMessage);

// 2. Mark system prompt boundary in the LLM call
const systemPrompt = `You are a nutrition assistant. ${SYSTEM_PROMPT_BOUNDARY}`;

// 3. Validate LLM output against expected schema
const result = validateAiResponse(llmOutput, expectedSchema);
if (!result) {
  return fallbackResponse;
}

// 4. (Optional) Check for dangerous dietary advice in AI output
if (containsDangerousDietaryAdvice(result.text)) {
  return safeFallbackResponse;
}
```

**Components:**

| Function                               | Purpose                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sanitizeUserInput(text)`              | Strips control characters, truncates to 2000 chars, replaces known injection patterns with `[filtered]` |
| `SYSTEM_PROMPT_BOUNDARY`               | Constant appended to system prompts instructing the LLM to ignore role-change requests                  |
| `validateAiResponse(response, schema)` | Validates LLM JSON output with `zod.safeParse()`, returns `null` on failure                             |
| `containsDangerousDietaryAdvice(text)` | Detects extreme calorie restriction, eating disorder promotion, dangerous supplement advice             |

**When to use:**

- Every AI service that accepts user text (chat, food parsing, photo analysis)
- Every AI service that returns structured data the app relies on

**When NOT to use:**

- Internal-only AI calls where user text is not part of the prompt
- Non-AI text processing (use standard input validation instead)

**Rationale:** LLMs are susceptible to prompt injection where user input can override system instructions. A dedicated sanitization module centralizes the defense so individual services do not need to reinvent it. Output validation with Zod prevents malformed LLM responses from crashing downstream code.

**References:**

- `server/lib/ai-safety.ts` -- all four exports
- `server/lib/__tests__/ai-safety.test.ts` -- 28 test cases covering injection patterns and dietary advice detection
- `server/services/food-nlp.ts`, `server/services/nutrition-coach.ts`, `server/services/photo-analysis.ts` -- consumers

### Sanitize ALL User Profile Fields in AI Prompts

When an AI service builds a prompt that includes user profile data (dietary preferences, allergies, goals, cooking skill, cuisine preferences), **every** user-controlled string must pass through `sanitizeUserInput()` before interpolation. User profile fields are indirect prompt injection vectors -- an attacker can set their "food dislikes" to an injection payload that executes when the field is interpolated into a meal suggestion or menu analysis prompt.

```typescript
// ❌ BAD: Raw profile fields interpolated into prompt
const context = `User diet: ${profile.dietType}. Dislikes: ${profile.foodDislikes?.join(", ")}`;

// ✅ GOOD: Every field sanitized before prompt interpolation
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

const context = `User diet: ${sanitizeUserInput(profile.dietType ?? "")}.
Dislikes: ${(profile.foodDislikes ?? []).map(sanitizeUserInput).join(", ")}`;

const systemPrompt = `You are a nutrition assistant. ${SYSTEM_PROMPT_BOUNDARY}`;
```

**Fields to sanitize** (non-exhaustive -- sanitize any user-editable string that reaches an LLM):

- `dietType`, `primaryGoal`, `cookingSkillLevel`
- `foodDislikes` (array -- sanitize each element)
- `cuisinePreferences` (array -- sanitize each element)
- `allergies` (array of objects -- sanitize the `name` field)
- Any free-text field from `userProfiles` or `users` tables

**Audit checklist for new AI services:**

1. Grep for `openai.chat.completions.create` (or equivalent) in the new file
2. Trace every variable in the `messages` array back to its source
3. If any variable originates from user input (directly or via profile), wrap it in `sanitizeUserInput()`
4. Ensure the system prompt includes `SYSTEM_PROMPT_BOUNDARY`

**Audit ref:** 2026-03-29-full H1 (`meal-suggestions.ts`), H2 (`menu-analysis.ts`)

**References:**

- `server/services/meal-suggestions.ts` -- `buildDietaryContext()` with 7 sanitized fields
- `server/services/menu-analysis.ts` -- `analyzeMenuPhoto()` with 5 sanitized fields
- `server/lib/ai-safety.ts` -- `sanitizeUserInput()`, `SYSTEM_PROMPT_BOUNDARY`

### Cross-Allergy Safety Filter for AI/External Suggestions

When a service returns food or ingredient recommendations from any source (AI, external API, static table), **always filter the output** against the user's declared allergens before returning results. AI exclusion prompts are insufficient as sole protection — models can and do ignore them.

```typescript
// After collecting suggestions from all tiers (static, Spoonacular, AI):
function filterSafeSubstitutions(
  suggestions: SubstitutionSuggestion[],
  userAllergies: { name: string; severity: AllergySeverity }[],
): SubstitutionSuggestion[] {
  if (userAllergies.length === 0) return suggestions;

  return suggestions.filter((s) => {
    // Reuse the same detectAllergens() engine to check each suggestion
    const matches = detectAllergens([s.substitute], userAllergies);
    return matches.length === 0;
  });
}

// Apply to ALL tiers combined, not just one:
const allSuggestions = [...staticResults, ...spoonacularResults, ...aiResults];
const safeSuggestions = filterSafeSubstitutions(allSuggestions, userAllergies);
```

**When to use:** Any service that returns food/ingredient suggestions to users who have declared dietary restrictions (allergens, intolerances, dislikes). Apply as a post-filter on the combined output of all suggestion sources.

**When NOT to use:** Recommendation systems without safety constraints (e.g., recipe browsing where the user hasn't declared restrictions).

**Why:** Without this filter, a tree-nut-allergic user can receive "almond flour" as a wheat substitute because: (1) static tables don't cross-reference allergens, (2) Spoonacular doesn't know about the user's allergies, and (3) AI models sometimes ignore exclusion instructions. This was caught as a critical safety bug in code review.

**References:**

- `server/services/ingredient-substitution.ts` -- `filterSafeSubstitutions()`, `buildExclusionList()`
- `shared/constants/allergens.ts` -- `detectAllergens()` pure function used for both detection and filtering

### API Key Authentication (Stripe-Style Prefix + Hash)

For public APIs where external developers authenticate with long-lived keys (not JWTs), use a split storage approach: a plaintext **prefix** for DB lookup and a **bcrypt hash** for verification. The full key is shown once at creation time, never again.

```typescript
// Key format: ocr_live_ + 32 hex chars (41 chars total)
const randomPart = crypto.randomBytes(16).toString("hex");
const plaintextKey = `ocr_live_${randomPart}`;

// PREFIX for DB lookup (must include random chars, not just the static part!)
const keyPrefix = plaintextKey.substring(0, KEY_PREFIX_LENGTH); // e.g., 16 chars

// HASH for verification (bcrypt — same as passwords)
const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_ROUNDS);

// Store prefix (indexed) + hash. Never store plaintext.
await db.insert(apiKeys).values({ keyPrefix, keyHash, name, tier });
```

**Auth middleware flow:**

1. Read key from `X-API-Key` header (reject query params — they get logged in URLs)
2. Extract prefix → DB lookup by indexed `keyPrefix` column
3. `bcrypt.compare(rawKey, keyRow.keyHash)` to verify
4. Cache validated keys in-memory (60s TTL, bounded Map) to skip DB + bcrypt on repeat requests
5. Set `req.apiKeyId` and `req.apiKeyTier` for downstream middleware

**Critical gotcha:** The prefix MUST include characters from the random portion of the key, not just the static prefix. If `KEY_PREFIX_LENGTH` only captures the static part (e.g., `"ocr_live"` = 8 chars), every key gets the same prefix and only one can ever authenticate.

**When to use:** Public-facing APIs with developer API keys (separate from user JWT auth).

**References:**

- `server/middleware/api-key-auth.ts` — `requireApiKey` middleware with in-memory cache
- `server/storage/api-keys.ts` — `createApiKey`, `getApiKeyByPrefix`

### PII Stripping in API Response Serialization

When internal data models contain user-identifying fields (e.g., `scannedByUserId`, `scannedAt`) that must never be exposed to external API consumers, create explicit serializer functions that allowlist fields rather than blocklist:

```typescript
// ✅ GOOD — allowlist approach: only include what's safe
function serializePaidResponse(row: BarcodeVerification): PaidProductResponse {
  const rawFrontLabel = row.frontLabelData as FrontLabelData | null;
  const frontLabel = rawFrontLabel
    ? {
        brand: rawFrontLabel.brand, // ← explicitly picked
        productName: rawFrontLabel.productName,
        netWeight: rawFrontLabel.netWeight,
        claims: rawFrontLabel.claims,
        // scannedByUserId: OMITTED
        // scannedAt: OMITTED
      }
    : null;
  return { ...data, frontLabel };
}

// ❌ BAD — blocklist approach: easy to miss new fields
const { scannedByUserId, scannedAt, ...safeFrontLabel } = rawFrontLabel;
```

**Why:** Allowlisting is safer than blocklisting. If a new PII field is added to the schema later, the blocklist approach silently leaks it. The allowlist approach requires explicitly adding each new field, defaulting to omission.

**Test pattern:** Assert the full JSON response body does NOT contain PII field names:

```typescript
const json = JSON.stringify(res.body);
expect(json).not.toContain("scannedByUserId");
expect(json).not.toContain("scannedAt");
```

**References:**

- `server/routes/public-api.ts` — `serializePaidResponse()`, `serializeFreeResponse()`

### Admin Auth via `isAdmin()` Allowlist

For admin-only endpoints (managing API keys, reviewing flags, system configuration), use a module-scoped `isAdmin()` function that checks the user's ID against a comma-separated `ADMIN_USER_IDS` environment variable. This is checked AFTER `requireAuth` — the user must be both authenticated and in the allowlist.

```typescript
// Module-scoped — reads env on each call so changes apply without restart
function isAdmin(userId: string): boolean {
  const adminIds = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .filter(Boolean);
  return adminIds.includes(userId);
}

// Every admin endpoint follows the same guard pattern:
app.get("/api/admin/resource", requireAuth, async (req, res) => {
  if (!req.userId || !isAdmin(req.userId)) {
    return sendError(res, 403, "Admin access required", "UNAUTHORIZED");
  }
  // ... admin logic
});
```

**Checklist for admin endpoints:**

1. Always apply `requireAuth` middleware first (establishes `req.userId`)
2. Check `isAdmin(req.userId)` as the first line in the handler
3. Return 403 (not 401) — the user is authenticated but lacks permission
4. Apply a rate limiter (admin endpoints are still abuse targets)

**When to use:** Any endpoint that should only be accessible to operators/admins (API key management, flag review, system health, data exports).

**When NOT to use:** Endpoints gated by subscription tier — use `checkPremiumFeature()` instead.

**Important:** Do NOT use `isAdmin()` as Express middleware because it needs `req.userId` from `requireAuth`, and the current pattern keeps the check explicit and visible in each handler. When the project adds RBAC, replace this allowlist with a role check.

**References:**

- `server/routes/admin-api-keys.ts` — API key CRUD (4 endpoints)
- `server/routes/verification.ts` — reformulation flag review/resolve (2 endpoints)
- Environment variable: `ADMIN_USER_IDS` (comma-separated user IDs)

### Rate Limiter Fail-Closed on Error

When a rate limiter's backing store (Redis, database, in-memory Map) throws an error, reject the request with 503 instead of letting it through. Fail-open is the default in many libraries but creates an exploitable bypass.

```typescript
// ✅ GOOD: Fail closed — reject when we can't verify limits
try {
  currentCount = await storage.getApiKeyUsage(apiKeyId, yearMonth);
} catch (err) {
  console.error("Rate limit check error:", err);
  sendError(res, 503, "Service temporarily unavailable", "SERVICE_UNAVAILABLE");
  return;
}

// ❌ BAD: Fail open — attacker can trigger store errors to bypass limits
try {
  currentCount = await storage.getApiKeyUsage(apiKeyId, yearMonth);
} catch (err) {
  console.error("Rate limit check error:", err);
  next(); // Let the request through!
  return;
}
```

**When to use:** Any custom rate limiter or usage counter where the backing store can fail. This includes API key monthly usage checks, per-user daily quotas, and any middleware that reads counts from a database.

**When NOT to use:** `express-rate-limit` with its default in-memory store (which cannot fail). If you use `express-rate-limit` with an external store (Redis), configure its `handler` option for fail-closed behavior.

**Why 503 (not 429):** The request is not over the limit — we simply cannot verify whether it is. 503 signals a temporary service issue, and clients with retry logic will back off.

**References:**

- `server/middleware/api-rate-limit.ts` — fail-closed on DB error

### Sensitive Path Logging Exclusion

Exclude response bodies for routes that return tokens, passwords, or medical data from request logging. Match by path prefix to catch sub-routes.

```typescript
const SENSITIVE_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/account",
  "/api/medication",
];

function isSensitivePath(reqPath: string): boolean {
  return SENSITIVE_PATHS.some(
    (p) => reqPath === p || reqPath.startsWith(p + "/"),
  );
}

// In request logger:
if (capturedJsonResponse && !isSensitivePath(reqPath)) {
  logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
}
```

**Why:** Request logs often end up in log aggregators, monitoring dashboards, and error tracking tools. Logging JWT tokens, hashed passwords, or medical data (medication names, dosages) in response bodies violates security best practices and may violate privacy regulations (HIPAA, GDPR).

**References:**

- `server/index.ts` — `setupRequestLogging()` with `isSensitivePath()` check

### Generic Error Messages for 5xx Responses

The global error handler returns the actual error message for 4xx (client errors) but a generic `"Internal Server Error"` for 5xx. This prevents leaking stack traces, SQL errors, or internal service details to clients.

```typescript
// Global error handler
const status = error.status || error.statusCode || 500;

// Only expose error messages for client errors (4xx)
const message =
  status < 500 ? error.message || "Bad Request" : "Internal Server Error";

return res.status(status).json({ error: message });
```

**Why:** A 500 error message like `"relation \"users\" does not exist"` or `"ECONNREFUSED 127.0.0.1:5432"` reveals database technology and network topology. Always log the real error server-side (`console.error`) and return a generic message to the client.

**References:**

- `server/index.ts` — `setupErrorHandler()`
