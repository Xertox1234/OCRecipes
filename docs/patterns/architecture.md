# Architecture Patterns

### Domain-Driven Storage Module Decomposition

When a storage layer (or any service layer) grows beyond ~500 lines, split it into domain-specific modules with shared helpers and a facade that preserves the original import path. The facade composes all modules into a single `storage` export so existing consumers do not need to change their imports.

```
server/storage/
  index.ts              # Facade — composes all modules into `storage` object
  helpers.ts            # Shared utilities (getDayBounds, escapeLike)
  users.ts              # User accounts, profiles, subscriptions
  nutrition.ts          # Scanned items, daily logs, saved items
  meal-plans.ts         # Recipes, meal items, grocery lists, pantry
  chat.ts               # Conversations, messages
  cache.ts              # Nutrition cache, suggestion cache, instruction cache
  community.ts          # Community recipes, social features
  medication.ts         # Medication logs
  fasting.ts            # Fasting logs
  menu.ts               # Restaurant menu scans
  cookbooks.ts          # Cookbooks and cookbook-recipe junction
  favourite-recipes.ts  # Favourite recipes toggle, resolve, share
  verification.ts       # Barcode verification pipeline
  api-keys.ts           # API key management
  batch.ts              # Batch scan storage
  carousel.ts           # Home carousel data
  profile-hub.ts        # Profile hub counts and aggregations
  receipt.ts            # IAP receipt storage
  reformulation.ts      # Product reformulation tracking
  sessions.ts           # Cooking and label analysis sessions
```

**Facade pattern:**

```typescript
// server/storage/index.ts
import * as users from "./users";
import * as nutrition from "./nutrition";
import * as mealPlans from "./meal-plans";
// ... other domain modules

export { escapeLike, getDayBounds } from "./helpers";

export const storage = {
  // Users & profiles
  getUser: users.getUser,
  getUserByUsername: users.getUserByUsername,
  createUser: users.createUser,
  // ... all other methods composed from domain modules

  // Nutrition
  getScannedItems: nutrition.getScannedItems,
  createScannedItem: nutrition.createScannedItem,
  // ...
};
```

**Shared helpers:**

```typescript
// server/storage/helpers.ts
/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/** Returns start (00:00:00.000) and end (23:59:59.999) of the given day. */
export function getDayBounds(date: Date): { startOfDay: Date; endOfDay: Date } {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
}
```

**When to use:**

- Any module exceeding ~500 lines where methods naturally cluster by domain
- When multiple developers work on different features that touch the same module (reduces merge conflicts)

**When NOT to use:**

- Small modules (< 200 lines) where splitting adds overhead without benefit
- Modules where all methods are tightly coupled and share internal state (splitting would require passing state between modules)

**Key design choices:**

1. **Facade preserves the import path** -- `import { storage } from "../storage"` works unchanged for all existing consumers
2. **Domain modules are plain exported functions** -- not classes, not singletons. They import `db` directly and export named functions
3. **Shared helpers live in `helpers.ts`** -- any utility used by 2+ domain modules (date bounds, string escaping) goes here
4. **Helpers are re-exported from the facade** -- consumers that need `getDayBounds` or `escapeLike` import from `"../storage"`, not `"../storage/helpers"`

**Rationale:** The original `storage.ts` was 2,400 lines with 100+ methods spanning 10 domains. Finding a method required searching through unrelated code. Merge conflicts were frequent when multiple features touched different domains. Splitting into domain modules with a backward-compatible facade eliminated both problems while requiring zero changes to the 40+ consumer files.

**References:**

- `server/storage/index.ts` -- facade with all method compositions
- `server/storage/helpers.ts` -- `getDayBounds`, `escapeLike`
- 19 domain modules (see directory listing above)

## Route Module Patterns

### Route Module Registration Structure

Every route file in the codebase follows a consistent structure: a named `register(app)` export, a module-scoped rate limiter, and a repeating handler pattern of `requireAuth` -> `checkPremiumFeature` (if premium) -> Zod validation -> business logic -> error response.

```typescript
// server/routes/medication.ts
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import {
  ipKeyGenerator,
  formatZodError,
  checkPremiumFeature,
} from "./_helpers";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";

// 1. Module-scoped rate limiter (domain-specific window + max)
const medicationRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many medication requests. Please wait." },
  keyGenerator: (req) => req.userId || ipKeyGenerator(req),
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. Named register function — app.ts imports and calls register(app)
export function register(app: Express): void {
  // 3. Each handler follows: requireAuth → premium gate → validate → logic → respond
  app.post(
    "/api/medication/log",
    requireAuth,
    medicationRateLimit,
    async (req: Request, res: Response) => {
      try {
        // Premium feature gate (returns null + sends 403 if not allowed)
        const features = await checkPremiumFeature(
          req,
          res,
          "glp1Companion",
          "GLP-1 Companion",
        );
        if (!features) return;

        // Zod validation with inline schema
        const schema = z.object({
          medicationName: z.string().max(100),
          dosage: z.string().max(50),
        });
        const parsed = schema.safeParse(req.body);
        if (!parsed.success)
          return res.status(400).json({ error: formatZodError(parsed.error) });

        // Business logic
        const log = await storage.createMedicationLog({
          userId: req.userId!,
          ...parsed.data,
        });
        res.status(201).json(log);
      } catch (error) {
        console.error("Create medication log error:", error);
        res.status(500).json({ error: "Failed to create medication log" });
      }
    },
  );
}
```

**Checklist for every new route module:**

1. Import from `_helpers` (shared rate limiters, `formatZodError`, `checkPremiumFeature`)
2. Define a domain-specific rate limiter at module scope with `keyGenerator: (req) => req.userId || ipKeyGenerator(req)`
3. Export a `register(app: Express): void` function
4. Use `requireAuth` middleware on every authenticated endpoint — never do manual `if (!req.userId)` checks
5. Use `checkPremiumFeature()` early-return pattern for premium features
6. Define Zod schemas inline in each handler (unless reused across handlers)
7. Wrap handler body in `try/catch` with `console.error` + generic 500 response
8. For single-resource endpoints (`:id`), include ownership verification: `if (item.userId !== req.userId) return 404`

**When to use:** Every new route module.

**When NOT to use:** This is a mandatory structural pattern, not optional.

**Reference files:** `server/routes/medication.ts`, `server/routes/fasting.ts`, `server/routes/weight.ts`, `server/routes/micronutrients.ts`, `server/routes/menu.ts`, `server/routes/chat.ts`

### Routes Must Not Import `db`

Route files (`server/routes/*.ts`) must never import `db` from `../db`. All database access — including transactions — goes through the `storage` facade. This enforces a clean dependency direction and keeps routes as thin HTTP handlers.

```
✅ routes → storage → db
❌ routes → db (bypasses storage abstraction)
```

```typescript
// ✅ Good: Route calls storage
import { storage } from "../storage";

const item = await storage.createScannedItemWithLog(itemData, { mealType });
```

```typescript
// ❌ Bad: Route imports db directly
import { db } from "../db";
import { scannedItems, dailyLogs } from "@shared/schema";

const item = await db.transaction(async (tx) => { ... });
```

**Why:**

- **Single responsibility** — routes handle HTTP concerns (parsing, validation, responses); storage handles data access
- **Testability** — mocking `storage.functionName()` is one line; mocking `db.transaction()` requires building fake transaction objects
- **Reuse** — when multiple routes need the same multi-table operation, a storage function eliminates duplication
- **Enforcement** — `grep -r 'from "../db"' server/routes/` should return zero results (excluding `__tests__/`)

**When to use:** Always. This is a mandatory architectural rule.

**Reference files:** All route files import from `"../storage"`, never from `"../db"`. See `server/routes/nutrition.ts`, `server/routes/photos.ts`, `server/routes/beverages.ts` for examples.

### When to Extract a Service from a Route

Route handlers should stay thin — parse request, call one service or storage function, send response. When a route orchestrates **3+ storage domains** or **computes derived values** from multiple data sources, extract the logic into a service (`server/services/*.ts`).

```
✅ routes → services → storage (cross-domain orchestration)
✅ routes → storage (single-domain read/write)
❌ routes with 5 storage calls, Promise.all, and math (too much business logic)
```

```typescript
// ❌ Before: route handler orchestrates 4 storage domains + computes derived value
app.get("/api/profile/widgets", requireAuth, async (req, res) => {
  const [user, summary, schedule, fast, weight] = await Promise.all([
    storage.getUser(req.userId),
    storage.getDailySummary(req.userId, date),
    storage.getFastingSchedule(req.userId),
    storage.getActiveFastingLog(req.userId),
    storage.getLatestWeight(req.userId),
  ]);
  const remaining = calorieGoal - foodCalories; // business logic in route
  res.json({ dailyBudget: { calorieGoal, foodCalories, remaining }, ... });
});

// ✅ After: service owns the orchestration, route stays thin
import { getProfileWidgets } from "../services/profile-hub";

app.get("/api/profile/widgets", requireAuth, async (req, res) => {
  const data = await getProfileWidgets(req.userId);
  if (!data) return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
  res.json(data);
});
```

**Extraction signals:**

- Route calls 3+ storage methods from different domains
- Route contains `Promise.all` with cross-domain fetches
- Route computes derived values (subtraction, aggregation, formatting)
- The same aggregation is needed by another endpoint or a background job

**What stays in the route:**

- Auth + rate limiting (middleware)
- Request validation (Zod parse)
- Error mapping (404, 400, 500)
- `res.json()` / `res.status()`

**Reference files:** `server/services/profile-hub.ts` (extracted from `server/routes/profile-hub.ts`)

### SSE Streaming for AI Responses

When an endpoint streams a response from an LLM (e.g., the nutrition coach chat), use Server-Sent Events (SSE) with a consistent event format. Accumulate the full response for persistence, then send a terminal `done` event.

```typescript
// Server: Stream AI response via SSE
app.post(
  "/api/chat/conversations/:id/messages",
  requireAuth,
  chatRateLimit,
  async (req: Request, res: Response) => {
    // ... validation, context building ...

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let fullResponse = "";
    try {
      for await (const chunk of generateCoachResponse(
        messageHistory,
        context,
      )) {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      // Persist the complete response
      await storage.createChatMessage(id, "assistant", fullResponse);

      // Terminal event
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch {
      res.write(
        `data: ${JSON.stringify({ error: "Failed to generate response" })}\n\n`,
      );
    }
    res.end();
  },
);
```

```typescript
// Service: AsyncGenerator wrapping OpenAI streaming
export async function* generateCoachResponse(
  messages: { role: "user" | "assistant" | "system"; content: string }[],
  context: CoachContext,
): AsyncGenerator<string> {
  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    stream: true,
    messages: [
      { role: "system", content: buildSystemPrompt(context) },
      ...messages,
    ],
    max_tokens: 1000,
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
```

**Key elements:**

1. **SSE headers:** `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
2. **`res.flushHeaders()`** — sends headers immediately so the client can start consuming
3. **Accumulate `fullResponse`** — needed for persisting the complete message to the database
4. **Terminal event:** `{ done: true }` tells the client the stream is complete
5. **Error event:** `{ error: "..." }` signals a mid-stream failure
6. **`res.end()`** — always close the connection after the stream ends

**When to use:** Any endpoint that streams LLM output or other long-running async results to the client.

**When NOT to use:** Short synchronous responses, batch operations, or endpoints where the entire response is available at once.

**Reference:** `server/routes/chat.ts`, `server/services/nutrition-coach.ts`

## Service Patterns

### Statistics Computation from Log Data

When computing insights, trends, or statistics from user log entries (weight logs, fasting logs, medication logs), use a pure function that takes typed log arrays and returns a fully-typed result object with nullable fields for missing data.

```typescript
// server/services/weight-trend.ts
export interface WeightTrendResult {
  avg7Day: number | null;
  avg30Day: number | null;
  weeklyRateOfChange: number | null;
  projectedGoalDate: string | null;
  currentWeight: number | null;
  entries: number;
}

export function calculateWeightTrend(
  logs: WeightEntry[],
  goalWeight?: number | null,
): WeightTrendResult {
  // Return empty result for no data (never throw)
  if (logs.length === 0) {
    return {
      avg7Day: null,
      avg30Day: null,
      weeklyRateOfChange: null,
      projectedGoalDate: null,
      currentWeight: null,
      entries: 0,
    };
  }

  // Sort, compute, return
  const sorted = [...logs].sort(
    (a, b) => b.loggedAt.getTime() - a.loggedAt.getTime(),
  );
  const currentWeight = parseFloat(sorted[0].weight);
  // ... compute averages, trends, projections
  return {
    avg7Day,
    avg30Day,
    weeklyRateOfChange,
    projectedGoalDate,
    currentWeight,
    entries: sorted.length,
  };
}
```

**Key elements:**

1. **Export a typed result interface** — all computed fields are named and typed, with `null` for missing/insufficient data
2. **Pure function** — takes data in, returns result, no side effects (no database calls, no mutations)
3. **Graceful empty handling** — return a null-filled result object for empty arrays, never throw
4. **Sort defensively** — copy and sort the input (`[...logs].sort(...)`) rather than mutating the caller's array
5. **Derive from multiple data sources** — use `Promise.all()` in the caller (route handler) to fetch data in parallel, then pass the resolved arrays to the pure function

This pattern is used in:

- `server/services/weight-trend.ts` — `calculateWeightTrend(logs, goalWeight)`
- `server/services/fasting-stats.ts` — `calculateFastingStats(logs)`
- `server/services/glp1-insights.ts` — `analyzeGlp1Insights(userId)` (note: this one fetches its own data, combining the `Promise.all` fetch and computation; the pure-function variant is preferred)

**When to use:** Any feature that shows trends, streaks, averages, or summaries computed from time-series log data.

**When NOT to use:** Simple CRUD operations that just read/write single records.

### GPT Vision Analysis with User Context Injection

When using GPT-4 Vision to analyze images (food photos, restaurant menus), inject the current user's profile and goals into the system prompt to get personalized results. Build user context separately and append it to the base prompt.

```typescript
// server/services/menu-analysis.ts
export async function analyzeMenuPhoto(
  imageBase64: string,
  userId: string,
): Promise<MenuAnalysisResult> {
  // 1. Build user context (non-critical — proceed without it on error)
  let userContext = "";
  try {
    const [user, profile] = await Promise.all([
      storage.getUser(userId),
      storage.getUserProfile(userId),
    ]);
    if (user) {
      const parts: string[] = [];
      if (user.dailyCalorieGoal)
        parts.push(`Daily calorie goal: ${user.dailyCalorieGoal}`);
      if (profile?.dietType) parts.push(`Diet type: ${profile.dietType}`);
      // ... allergies, dislikes, etc.
      if (parts.length > 0) {
        userContext = `\n\nUser context for personalized recommendations:\n${parts.join("\n")}`;
      }
    }
  } catch {
    // Non-critical — proceed without personalization
  }

  // 2. Send image + system prompt (base + user context) to Vision API
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: BASE_PROMPT + userContext },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${imageBase64}`,
              detail: "high",
            },
          },
          { type: "text", text: "Analyze this restaurant menu..." },
        ],
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
    temperature: 0.3,
  });

  // 3. Validate response with Zod
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("No response from analysis");
  const parsed = JSON.parse(content);
  return menuAnalysisSchema.parse(parsed);
}
```

**Key elements:**

1. **User context is non-critical** — wrap in try/catch, proceed without personalization if profile fetch fails
2. **Build context as string parts** — conditionally add only non-null profile fields
3. **Append to system prompt** — `BASE_PROMPT + userContext`, not a separate message
4. **Use `response_format: { type: "json_object" }`** — ensures structured output from GPT
5. **Validate with Zod** — `menuAnalysisSchema.parse(parsed)` catches unexpected response shapes
6. **Low temperature (0.3)** — for factual/analytical tasks, reduce randomness

**When to use:** Any endpoint that sends images to GPT Vision with user-specific recommendations (menu analysis, food photo analysis, label scanning).

**When NOT to use:** Generic image analysis without user personalization, or text-only AI interactions.

**Reference files:** `server/services/menu-analysis.ts`, `server/services/photo-analysis.ts`

### Static Lookup Map with Normalization

When a domain requires mapping regional or cultural names to standardized terms (e.g., cultural food names to nutrition database terms), use a typed static array with a normalized string matching function. This avoids external API calls for common cases.

```typescript
// server/services/cultural-food-map.ts
interface CulturalFoodEntry {
  standardName: string;
  aliases: string[];
  cuisine: string;
  typicalServing: string;
  category:
    | "protein"
    | "vegetable"
    | "grain"
    | "fruit"
    | "dairy"
    | "beverage"
    | "other";
}

const CULTURAL_FOOD_MAP: CulturalFoodEntry[] = [
  {
    standardName: "lentil curry",
    aliases: ["dal", "daal", "dhal", "toor dal", "masoor dal"],
    cuisine: "South Asian",
    typicalServing: "1 cup",
    category: "protein",
  },
  // ... more entries
];

// Normalized lookup with includes-based matching
export function lookupCulturalFood(
  query: string,
): CulturalFoodEntry | undefined {
  const normalized = query.toLowerCase().trim();
  return CULTURAL_FOOD_MAP.find(
    (entry) =>
      entry.standardName === normalized ||
      entry.aliases.some((alias) => normalized.includes(alias)),
  );
}

// Higher-level convenience: resolve to standard name or pass through
export function getStandardizedFoodName(query: string): string {
  const entry = lookupCulturalFood(query);
  return entry ? entry.standardName : query;
}
```

**Key elements:**

1. **Typed entry interface** — defines the shape of each mapping with union types for categories
2. **Static array** — no database or API dependency, instant lookups, easily extensible
3. **Normalized matching** — lowercase + trim before comparing
4. **`includes()`-based alias matching** — allows partial matches ("pad thai" matches even in "pad thai with chicken")
5. **Passthrough fallback** — `getStandardizedFoodName()` returns the original query if no mapping exists
6. **Convenience functions** — export targeted helpers (`getCuisineForFood`, `getTypicalServing`) that wrap the core lookup

**When to use:** Domain-specific name resolution where the mapping is finite, curated, and does not require real-time data. Examples: cultural food names, exercise name synonyms, unit conversions.

**When NOT to use:** Mappings that need to be dynamically updated, user-contributed, or sourced from external APIs. Use a database table or external API instead.

**Reference:** `server/services/cultural-food-map.ts`

### Static-First with AI Fallback

When a service needs AI-generated suggestions but many inputs have well-known answers, check a static lookup map first and only call the AI API for inputs not covered by the map. This saves API cost and latency for common cases while still handling the long tail.

```typescript
// server/services/ingredient-substitution.ts

const COMMON_SUBSTITUTIONS: Record<string, StaticSubstitution[]> = {
  butter: [
    { name: "coconut oil", ratio: "1:1", tags: ["dairy-free", "vegan"], macroDelta: { ... } },
    { name: "olive oil", ratio: "3/4 cup per 1 cup", tags: ["dairy-free"], macroDelta: { ... } },
  ],
  // ... other common ingredients
};

export async function getSubstitutions(ingredients, userProfile) {
  const staticResults: SubstitutionSuggestion[] = [];
  const needsAi: CookingSessionIngredient[] = [];

  // Phase 1: Check static map
  for (const ingredient of ingredients) {
    const staticSubs = findStaticSubstitutions(ingredient.name, dietaryTags);
    if (staticSubs.length > 0) {
      staticResults.push(...staticSubs.map(toSuggestion));
    } else {
      needsAi.push(ingredient);
    }
  }

  // Phase 2: AI fallback only for unmatched ingredients
  let aiResults: SubstitutionSuggestion[] = [];
  if (needsAi.length > 0) {
    aiResults = await getAiSubstitutions(needsAi, profileSummary);
  }

  return { suggestions: [...staticResults, ...aiResults] };
}
```

**Key elements:**

1. **Partition inputs** — split into static-resolvable and needs-AI buckets in a single pass
2. **Static results have high confidence** — assign a fixed confidence (e.g., 0.9) since they're curated
3. **AI only called when needed** — if all ingredients are common, zero API calls
4. **Graceful AI failure** — static results still returned even if AI call throws
5. **Same output shape** — both paths produce the same `SubstitutionSuggestion` type

**When to use:** Any service where a curated subset of inputs covers the majority of real-world usage and an AI/API call handles the rest. Examples: ingredient substitutions, food name normalization, unit conversions with unusual units.

**When NOT to use:** When the static map would need constant updates or when AI quality is always superior (e.g., personalized recommendations that depend heavily on user context).

**Reference:** `server/services/ingredient-substitution.ts`

### Audio-to-Structured-Data Pipeline

> **Note:** The mobile client no longer uses this server-side pipeline. Voice input now uses on-device speech recognition via `expo-speech-recognition` (see "Client-Side Voice-to-Text-Input Pattern" below). The server endpoint and Whisper service remain available for potential non-mobile clients but are currently unused. Consider removing in a future cleanup.

When a feature accepts voice input and needs to produce structured data (food items, exercise descriptions, notes), chain two services: (1) audio transcription via Whisper, and (2) text parsing via an LLM with JSON output mode. The route handler orchestrates both steps and returns the intermediate transcription alongside the parsed results.

```typescript
// server/routes/food.ts — voice food logging endpoint
app.post(
  "/api/food/transcribe",
  requireAuth,
  audioUpload.single("audio"),
  async (req, res) => {
    // Step 1: Audio -> Text (Whisper)
    const transcription = await transcribeAudio(
      req.file.buffer,
      req.file.originalname,
    );
    if (!transcription.trim()) {
      return res.status(400).json({ error: "Could not transcribe audio" });
    }

    // Step 2: Text -> Structured data (GPT with JSON mode)
    const items = await parseNaturalLanguageFood(transcription);

    // Return both the raw transcription and parsed items
    res.json({ transcription, items });
  },
);
```

```typescript
// server/services/voice-transcription.ts — Whisper wrapper
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
): Promise<string> {
  const file = await toFile(buffer, filename, { type: "audio/m4a" });
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
    prompt: "Food and nutrition logging. The user is describing what they ate.",
    //       ^-- Domain-specific prompt improves transcription accuracy
  });
  return transcription.text;
}
```

```typescript
// server/services/food-nlp.ts — NLP structured output
export async function parseNaturalLanguageFood(
  text: string,
): Promise<ParsedFoodItem[]> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.1, // Low temp for deterministic parsing
    response_format: { type: "json_object" }, // Force JSON output
    messages: [
      {
        role: "system",
        content: `Parse food descriptions into structured items.
        Return JSON: { "items": [{ "name": string, "quantity": number, "unit": string }] }`,
      },
      { role: "user", content: text },
    ],
  });

  const parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  if (!parsed.items || !Array.isArray(parsed.items)) return [];

  // Step 3: Enrich each parsed item with nutrition data
  const results: ParsedFoodItem[] = [];
  for (const item of parsed.items) {
    const nutrition = await lookupNutrition(
      `${item.quantity} ${item.unit} ${item.name}`,
    );
    results.push({ ...item, calories: nutrition?.calories ?? null /* ... */ });
  }
  return results;
}
```

**Key elements:**

1. **Two-service chain** — Whisper handles speech-to-text, GPT handles text-to-structure. Each service has a single responsibility.
2. **Domain-specific Whisper prompt** — improves transcription accuracy for food-related vocabulary
3. **`response_format: { type: "json_object" }`** — forces the LLM to output valid JSON, preventing markdown or conversational responses
4. **Low temperature (0.1)** — minimizes hallucination for parsing tasks
5. **Return intermediate transcription** — client can show the raw transcript for user verification
6. **Enrich after parsing** — nutrition lookup happens per-item after NLP extraction, not during
7. **Graceful degradation** — if nutrition lookup fails for an item, return it with null calories rather than failing the whole request

**When to use:** Any voice-input feature that produces structured data (food logging, exercise logging, dictated notes).

**When NOT to use:** Direct voice-to-action features where the intermediate text is not useful (voice commands).

**References:**

- `server/routes/food.ts` — `POST /api/food/transcribe`
- `server/services/voice-transcription.ts` — `transcribeAudio()`
- `server/services/food-nlp.ts` — `parseNaturalLanguageFood()`

#### Client-Side Voice-to-Text-Input Pattern

When a screen has a text input that accepts voice dictation, use the `useSpeechToText` hook which wraps `expo-speech-recognition` for on-device streaming speech-to-text. Gate the UI behind `usePremiumFeature("voiceLogging")`.

```typescript
// Hook composition
const hasVoiceLogging = usePremiumFeature("voiceLogging");
const {
  isListening,
  transcript,
  isFinal,
  volume,
  error: speechError,
  startListening,
  stopListening,
} = useSpeechToText();

// Toggle handler — tap to start, tap again to stop early
const handleVoicePress = useCallback(() => {
  haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
  if (isListening) {
    stopListening();
  } else {
    startListening();
  }
}, [isListening, startListening, stopListening, haptics]);

// Stream transcript into input as user speaks
useEffect(() => {
  if (isListening && transcript) {
    setInputValue(transcript);
  }
}, [isListening, transcript]);

// Handle final result (auto-stop after ~3s silence on iOS)
useEffect(() => {
  if (isFinal && transcript) {
    setInputValue(transcript);
  }
}, [isFinal, transcript]);

// Show speech errors
useEffect(() => {
  if (speechError) showError(speechError);
}, [speechError]);
```

**Key conventions:**

- Uses `expo-speech-recognition` for on-device recognition (no server round-trip, no Whisper API cost)
- `continuous: false` — iOS auto-stops after ~3s silence (no second tap required)
- `interimResults: true` — words appear in the input as the user speaks
- `volumeChangeEventOptions` — drives volume-reactive scale animation on mic buttons
- Use `InlineMicButton` for compact input-row placement (20px icon, volume-reactive scale 1.0–1.3)
- Use `VoiceLogButton` for standalone placement (56px circle, volume-reactive scale 1.0–1.2)
- Both buttons show `"mic"` icon always (not `"mic-off"` since auto-stop handles it)
- Stop listening when the screen/sheet dismisses
- Haptic feedback on every press (medium impact)
- Placeholder changes to `"Listening..."` while active

**References:**

- `client/hooks/useSpeechToText.ts` — on-device speech-to-text hook
- `client/screens/QuickLogScreen.tsx` — standalone voice + text parse flow
- `client/components/meal-plan/SimpleEntrySheet.tsx` — inline voice in bottom sheet
- `client/components/InlineMicButton.tsx` — compact inline mic button
- `client/components/VoiceLogButton.tsx` — standalone mic button

### MET-Based Calorie Burn Formula

When calculating calories burned from exercise, use the standard MET (Metabolic Equivalent of Task) formula as a pure function. This is a well-established exercise science formula that requires no external API calls.

```typescript
// server/services/exercise-calorie.ts
/**
 * MET-based calorie burn calculator.
 * Formula: calories = MET * weight_kg * duration_hours
 */
export function calculateCaloriesBurned(
  metValue: number,
  weightKg: number,
  durationMinutes: number,
): number {
  const durationHours = durationMinutes / 60;
  return Math.round(metValue * weightKg * durationHours);
}
```

```typescript
// Usage in route handler — auto-calculate when client omits caloriesBurned
let caloriesBurned = validated.caloriesBurned;
if (!caloriesBurned) {
  const exercises = await storage.searchExerciseLibrary(
    validated.exerciseName,
    req.userId!,
  );
  const match = exercises.find(
    (e) => e.name.toLowerCase() === validated.exerciseName.toLowerCase(),
  );
  if (match) {
    const user = await storage.getUser(req.userId!);
    const weightKg = user?.weight ? parseFloat(user.weight) : 70; // Default 70kg
    caloriesBurned = calculateCaloriesBurned(
      parseFloat(match.metValue),
      weightKg,
      validated.durationMinutes,
    );
  }
}
```

**Key elements:**

1. **Pure function** — no side effects, no database calls, trivially testable
2. **Default weight fallback** — when user weight is unknown, use 70kg (WHO average)
3. **MET values from exercise library** — stored in database, not hardcoded, allowing user-contributed exercises
4. **Auto-calculate only when not provided** — client can override with a manually entered value

**When to use:** Any exercise tracking feature that needs calorie estimates from activity type + duration + body weight.

**References:**

- `server/services/exercise-calorie.ts` — `calculateCaloriesBurned()`
- `server/routes/exercises.ts` — `POST /api/exercises` (auto-calculation logic)

### Private Raw Function with Public Cached Wrapper

When adding caching to an existing service function, keep the raw (uncached) function private and export only the cached wrapper. This prevents callers from accidentally bypassing the cache.

```typescript
// server/services/micronutrient-lookup.ts

/**
 * Raw USDA lookup — private, no caching.
 * Only called by the cached wrapper below.
 */
async function lookupMicronutrients(
  foodName: string,
): Promise<MicronutrientData[]> {
  // ... external API call ...
}

/**
 * Public cached wrapper — the only exported entry point for lookups.
 */
export async function lookupMicronutrientsWithCache(
  foodName: string,
): Promise<MicronutrientData[]> {
  const key = cacheKey(foodName);
  const cached = await storage.getMicronutrientCache(key);
  if (cached) return cached as MicronutrientData[];

  const result = await lookupMicronutrients(foodName);
  if (result.length > 0) {
    storage.setMicronutrientCache(key, result, TTL_MS).catch(console.error);
  }
  return result;
}

/**
 * Batch wrapper — parallel cached lookups.
 */
export async function batchLookupMicronutrients(
  foodNames: string[],
): Promise<MicronutrientData[][]> {
  return Promise.all(foodNames.map(lookupMicronutrientsWithCache));
}
```

**When to use:**

- Adding caching to an external API call that was previously called directly
- The raw function is expensive (network, cost, latency) and should never be called without caching
- Multiple callers exist (single-item lookup, batch lookup) that should all go through the cache

**When NOT to use:**

- The raw function is still needed without caching in some contexts (keep it exported, add a separate cached variant)
- The function is already cheap and caching is optional

**Key elements:**

1. **Private raw function** — `async function lookupX()` without `export` prevents direct access from other modules
2. **Public cached wrapper** — `export async function lookupXWithCache()` is the only exported entry point
3. **Fire-and-forget cache write** — `fireAndForget(label, promise)` on the cache set so responses are not blocked (see [Fire-and-Forget](#fire-and-forget-for-non-critical-background-operations))
4. **Batch wrapper delegates to cached wrapper** — `Promise.all(names.map(lookupXWithCache))` ensures every item benefits from the cache
5. **Cache key normalization** — normalize inputs (trim, lowercase) before cache lookup to maximize hit rate

**References:**

- `server/services/micronutrient-lookup.ts` — `lookupMicronutrients` (private), `lookupMicronutrientsWithCache` (public), `batchLookupMicronutrients` (batch)

### Public API Namespace Isolation

When adding a public-facing API alongside internal app routes, mount it on a separate Express Router with its own middleware chain to avoid conflicts with `requireAuth` and other app-level middleware.

```typescript
// server/routes/public-api.ts
export function register(app: Express): void {
  const router = Router();

  // Middleware scoped to public API only — does NOT use requireAuth
  router.use(cors({ origin: "*", methods: ["GET"] }));
  router.use(requireApiKey);    // API key auth, not JWT
  router.use(apiRateLimiter);   // Monthly billing limiter, not express-rate-limit

  router.get("/products/:barcode", async (req, res) => { ... });

  // Mount at /api/v1 — separate from internal /api/* routes
  app.use("/api/v1", router);
}
```

**Registration order in `server/routes.ts`:**

```typescript
// Public API first (separate namespace, own auth middleware)
registerApiDocs(app); // GET /api/v1/docs (unauthenticated)
registerPublicApi(app); // GET /api/v1/products/:barcode (API key auth)
registerAdminApiKeys(app); // /api/admin/api-keys (JWT + admin allowlist)

// Internal app routes (all use requireAuth)
registerAuth(app);
registerProfile(app);
// ...
```

**Key elements:**

1. **Separate Router** — isolates middleware chain from internal routes
2. **Different auth** — `requireApiKey` instead of `requireAuth`
3. **Versioned prefix** — `/api/v1/` allows future breaking changes via `/api/v2/`
4. **Scoped CORS** — public API may use `origin: "*"` (API key auth, not cookies); internal routes do not
5. **Register before internal routes** — prevents internal `requireAuth` from intercepting public API paths

**References:**

- `server/routes/public-api.ts` — public API router with scoped middleware
- `server/routes.ts` — registration order

### Cross-Domain Storage Modules

When a feature spans multiple domain tables (e.g., batch scan creates `scannedItems` + `dailyLogs` + `pantryItems` + `groceryListItems`), create a dedicated cross-domain storage module rather than adding methods to an existing domain module. Use `db.transaction()` to maintain atomicity.

```typescript
// server/storage/batch.ts — cross-domain module
import { db } from "../db";
import { scannedItems, dailyLogs, pantryItems } from "@shared/schema";

export async function batchCreateScannedItemsWithLogs(
  items: ResolvedBatchItem[],
  userId: string,
): Promise<{ scannedCount: number; logCount: number }> {
  return db.transaction(async (tx) => {
    // Step 1: Batch INSERT scannedItems → .returning({ id })
    const scannedRows = await tx.insert(scannedItems).values(...).returning({ id: scannedItems.id });
    // Step 2: Batch INSERT dailyLogs using returned IDs (FK dependency)
    const logRows = await tx.insert(dailyLogs).values(...).returning({ id: dailyLogs.id });
    return { scannedCount: scannedRows.length, logCount: logRows.length };
  });
}
```

**Use typed errors for domain-specific failures:**

```typescript
export class BatchStorageError extends Error {
  constructor(
    message: string,
    public code: "NOT_FOUND" | "LIMIT_REACHED",
  ) {
    super(message);
    this.name = "BatchStorageError";
  }
}
```

The route handler checks `instanceof BatchStorageError` + `error.code` — never string-match on `error.message`.

**When to use:** Any feature that writes to 2+ tables from different domain modules in a single operation.

**References:**

- `server/storage/batch.ts` — cross-domain batch scan storage
- `server/routes/batch-scan.ts` — typed error handling in route

### Generic In-Memory Session Store Factory

When multiple route modules need in-memory session stores with the same lifecycle pattern (Map storage + per-user limits + global limit + auto-expiry timeouts), use the `createSessionStore<T>()` factory instead of duplicating the Map+timeout+userCount boilerplate.

```typescript
// server/storage/sessions.ts — factory function
import { createSessionStore } from "../storage/sessions";

interface CookingSession {
  userId: string;
  ingredients: Ingredient[];
  photos: string[];
  createdAt: number;
}

const cookStore = createSessionStore<CookingSession>({
  maxPerUser: 2,
  maxGlobal: 1000,
  timeoutMs: 30 * 60 * 1000, // 30 min TTL
  label: "active cooking", // Used in error messages
});

// Route handler usage:
const check = cookStore.canCreate(req.userId!);
if (!check.allowed) {
  return sendError(res, 429, check.reason, check.code);
}
const sessionId = cookStore.create({
  userId: req.userId!,
  ingredients: [],
  photos: [],
  createdAt: Date.now(),
});
const session = cookStore.get(sessionId)!;
```

**Test access via `_internals`:**

```typescript
// Exported for testing — gives direct access to internal Maps
export const _testInternals = {
  cookSessionStore: cookStore._internals.store,
  cookSessionTimeouts: cookStore._internals.timeouts,
  userCookSessionCount: cookStore._internals.userCount,
  clearCookSession: cookStore.clear,
  resetSessionTimeout: cookStore.resetTimeout,
};
```

The `_internals` property exposes the underlying `Map` instances so tests can inspect or reset state without going through the public API. This avoids making internal state public while still enabling thorough testing.

**Key elements:**

1. **Type parameter `T extends { userId: string; createdAt: number }`** — ensures every session has the fields needed for user-count tracking and diagnostics
2. **`canCreate()` returns a discriminated union** — `{ allowed: true }` or `{ allowed: false; reason: string; code: string }` so the caller can forward the error message directly to `sendError()`
3. **`create()` auto-generates UUID and auto-sets timeout** — no manual `crypto.randomUUID()` + `setTimeout()` boilerplate
4. **`_internals` for test access** — exposes the three internal Maps without polluting the public interface

**When to use:**

- Any in-memory session store that needs per-user + global limits + auto-expiry
- When 2+ route modules implement the same Map+timeout+count pattern

**When NOT to use:**

- Database-backed sessions (use `db.transaction()` instead)
- Single-use session stores with no limits or timeouts (a plain `Map` suffices)

**References:**

- `server/storage/sessions.ts` — `createSessionStore<T>()` factory + `analysisStore`, `labelStore` instances
- `server/routes/cooking.ts` — `cookStore` instance
- `server/routes/verification.ts` — `frontLabelStore` instance

### Storage Layer Purity: No Service Dependencies

Storage modules (`server/storage/*.ts`) must only depend on the database (`db`), the schema (`@shared/schema`), and shared helpers (`./helpers.ts`). They must **not** import from `server/services/` or `server/routes/`. This maintains a clean dependency direction: routes -> services -> storage.

```
✅ routes → services → storage → db/schema
❌ storage → services (creates circular risk, hides business logic in data layer)
```

**Example: `inferMealTypes` moved from storage to routes:**

```typescript
// ❌ BAD: storage calls a service function
// server/storage/meal-plans.ts
import { inferMealTypes } from "../services/meal-type-inference";

export async function createMealPlanRecipe(recipe, ingredients) {
  const mealTypes = recipe.mealTypes?.length
    ? recipe.mealTypes
    : inferMealTypes(
        recipe.title,
        ingredients?.map((i) => i.name),
      );
  // ...
}

// ✅ GOOD: route layer infers, passes result to storage
// server/routes/meal-plan.ts
import { inferMealTypes } from "../services/meal-type-inference";

const mealTypes = inferMealTypes(
  recipeData.title,
  ingredients?.map((i) => i.name),
);
const recipe = await storage.createMealPlanRecipe(
  { ...recipeData, mealTypes },
  ingredients,
);
```

**When to use:** Always. Every storage method should be a pure data-access layer that takes fully-resolved parameters and returns database results.

**When NOT to use:** Never violate this rule. If a storage method needs derived data, compute it in the route/service layer and pass it as a parameter.

**References:**

- `server/storage/meal-plans.ts` — `createMealPlanRecipe()` (no longer imports from services)
- `server/routes/meal-plan.ts`, `server/routes/recipes.ts` — callers that now compute `mealTypes` before calling storage

### Structured Logging Conventions

All server logging uses pino via `server/lib/logger.ts`. AsyncLocalStorage automatically injects `requestId` and `userId` into every log call within a request context.

**Imports by module type:**

- **Routes / middleware / lib / storage:** `import { logger, toError } from "../lib/logger"`
- **Services:** `import { createServiceLogger, toError } from "../lib/logger"` + `const log = createServiceLogger("service-name")` where the name matches the filename

**Log levels:**

| Level   | Use for                                        | Example                                                                   |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------- |
| `fatal` | Process crash (uncaughtException only)         | `logger.fatal({ err }, "uncaught exception")`                             |
| `error` | Operation failed, caller will handle           | `logger.error({ err: toError(error) }, "lookup error")`                   |
| `warn`  | Degraded state, missing config, Zod validation | `logger.warn({ zodErrors: parsed.error.flatten() }, "validation failed")` |
| `info`  | Operational status, startup/shutdown           | `logger.info({ port }, "server started")`                                 |
| `debug` | Diagnostics hidden in production               | `log.debug({ duration, source }, "nutrition source queried")`             |

**Error serialization — always use `toError()`:**

```typescript
} catch (error) {
  logger.error({ err: toError(error) }, "route error");
}
```

**Zod validation failures — use `zodErrors` key at `warn` level:**

```typescript
if (!parsed.success) {
  log.warn({ zodErrors: parsed.error.flatten() }, "validation failed");
}
```

**Message style:** lowercase, concise. Keep proper nouns capitalized (DALL-E, HealthKit, Spoonacular).

**References:**

- `server/lib/logger.ts` — pino instance, `mixin` for ALS context, `toError()` helper
- `server/lib/request-context.ts` — AsyncLocalStorage store, `setRequestUserId()`
- `server/index.ts` — pino-http middleware config, `genReqId`, serializers
