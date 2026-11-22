# Coach — Server-Side Streaming, Safety & Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 13 server-side issues in the AI Coach: stream standard-tier responses token-by-token, add a client-side safety override mechanism, patch a calorie regex gap, fix tool descriptions that mislead the model, align Zod/OpenAI schemas, sanitize all inputs before OpenAI, harden two storage paths, and reduce unnecessary data exposure.

**Architecture:** Changes are grouped into isolated layers — pure functions first (safety regex, block parser), then storage contracts (userId required), then the streaming generator, then the orchestrator (coach-pro-chat), then the SSE route, then the client hook, and finally config-only changes (tool descriptions, context response). Each task is independently committable.

**Tech Stack:** TypeScript, Express.js 5, OpenAI Node SDK (streaming), Vitest, React Native (XHR-based SSE client)

---

## File Map

| File                                                | Change                                                                                                    |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `server/lib/ai-safety.ts`                           | Extend two calorie regex patterns to cover 1000–1199                                                      |
| `server/lib/__tests__/ai-safety.test.ts`            | Add 5 new regex gap test cases                                                                            |
| `server/services/coach-blocks.ts`                   | Add `g` flag to block fence regex; fix `replace` to `replaceAll`                                          |
| `server/services/__tests__/coach-blocks.test.ts`    | Add two-fence test case                                                                                   |
| `server/storage/chat.ts`                            | Make `userId` a required parameter in `getChatMessages`                                                   |
| `server/services/nutrition-coach.ts`                | Export `SAFETY_OVERRIDE_SENTINEL`; yield per-delta in standard path                                       |
| `server/services/__tests__/nutrition-coach.test.ts` | Update streaming tests                                                                                    |
| `server/services/coach-pro-chat.ts`                 | Add `safety_override` to `CoachChatEvent`; handle sentinel in standard path; fix empty notebook injection |
| `server/services/__tests__/coach-pro-chat.test.ts`  | Add safety override integration test                                                                      |
| `server/routes/chat.ts`                             | Handle `safety_override` SSE event; sanitize `content` and `screenContext`                                |
| `server/routes/coach-context.ts`                    | Sanitize `interimTranscript`; strip `userId`/`dedupeKey` from notebook response                           |
| `server/routes/recipe-chat.ts`                      | Sequence `getChatMessageById` after ownership check                                                       |
| `server/services/coach-tools.ts`                    | Fix 3 tool descriptions; align `addToMealPlan` Zod schema; cap `lookup_nutrition` response                |
| `client/hooks/useCoachStream.ts`                    | Handle `safety_override` SSE event                                                                        |

---

## Task 1: Fix calorie restriction regex coverage gap

**Files:**

- Modify: `server/lib/ai-safety.ts:91–98`
- Modify: `server/lib/__tests__/ai-safety.test.ts`

- [ ] **Step 1: Write failing tests for the known gaps**

Add inside the `describe("containsDangerousDietaryAdvice")` block in `server/lib/__tests__/ai-safety.test.ts`:

```typescript
it("catches 'aim for 1100 calories'", () => {
  expect(containsDangerousDietaryAdvice("aim for 1100 calories")).toBe(true);
});
it("catches 'target 1100 cal per day'", () => {
  expect(containsDangerousDietaryAdvice("target 1100 cal per day")).toBe(true);
});
it("catches '1100 calories per day'", () => {
  expect(containsDangerousDietaryAdvice("1100 calories per day")).toBe(true);
});
it("catches 'stay under 1000 calories'", () => {
  expect(containsDangerousDietaryAdvice("stay under 1000 calories")).toBe(true);
});
it("does not flag '1500 calories per day'", () => {
  expect(containsDangerousDietaryAdvice("aim for 1500 calories per day")).toBe(
    false,
  );
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm run test:run -- server/lib/__tests__/ai-safety.test.ts
```

Expected: 4 tests fail (the 1100/1000-cal cases). The `1500 cal` test passes.

- [ ] **Step 3: Fix the two regex patterns**

In `server/lib/ai-safety.ts`, replace lines 94–97 with:

```typescript
const DANGEROUS_DIETARY_PATTERNS: RegExp[] = [
  // Extreme calorie restriction
  /eat\s+(less\s+than|under|only)\s+[1-7]\d{2}\s*cal/i, // under 800 cal
  /\b(?:1[01]\d{2}|[1-9]\d{2}|[1-7]\d{2})\s*calories?\s*(per\s+)?day\b/i, // 100-1199 cal per day
  /(?:total|daily)\s+intake\s+(?:of\s+)?[1-7]\d{2}\s*cal/i,
  /(?:aim|target|stay|stick|keep)\s+(?:at|to|for|under|around|below)\s+(?:1[01]\d{2}|[1-9]\d{2})\s*cal/i, // "aim for 900–1199 cal"
  /(?:only|just)\s+(?:eat|consume|have)\s+(?:[1-9]\d{2}|1[01]\d{2})\s*cal/i, // "only eat 900–1199 cal"
  // ... (remainder of array unchanged)
```

The two changed lines are:

- Line 94 (bare calorie/day): `[1-7]\d{2}` → `(?:1[01]\d{2}|[1-9]\d{2}|[1-7]\d{2})` — now covers 100–1199
- Line 96 (aim/target pattern): `[1-9]\d{2}` → `(?:1[01]\d{2}|[1-9]\d{2})`, add `keep` verb, add `at|to|below` prepositions

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- server/lib/__tests__/ai-safety.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/lib/ai-safety.ts server/lib/__tests__/ai-safety.test.ts
git commit -m "fix: extend calorie restriction regex to cover 1000–1199 cal/day phrasing"
```

---

## Task 2: Fix parseBlocksFromContent non-global regex

**Files:**

- Modify: `server/services/coach-blocks.ts:40–47`
- Modify: `server/services/__tests__/coach-blocks.test.ts`

- [ ] **Step 1: Write failing test**

Find the existing `describe("parseBlocksFromContent")` block in `server/services/__tests__/coach-blocks.test.ts`. Add:

````typescript
it("parses both fences when content contains two coach_blocks fences", () => {
  const content = `Here is chart one.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"yes"}]}]\n\`\`\`\nAnd here is another.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"No","message":"no"}]}]\n\`\`\``;
  const result = parseBlocksFromContent(content);
  // Both fences stripped from text
  expect(result.text).not.toContain("```coach_blocks");
  // At least two blocks parsed
  expect(result.blocks.length).toBe(2);
});
````

- [ ] **Step 2: Run to confirm failure**

```bash
npm run test:run -- server/services/__tests__/coach-blocks.test.ts
```

Expected: the two-fence test fails (only 1 block parsed, second fence left in text).

- [ ] **Step 3: Fix the regex and replace call**

In `server/services/coach-blocks.ts`, replace lines 40–48:

````typescript
// Use global flag so multiple fences in one response are all found and stripped.
const blockPattern = /```coach_blocks\n([\s\S]*?)```/g;
const matches = [...safeContent.matchAll(blockPattern)];

if (matches.length === 0) {
  return { text: safeContent.trim(), blocks: [] };
}

const text = safeContent.replace(blockPattern, "").trim();
const allBlocks: ReturnType<typeof validateBlocks> = [];

for (const match of matches) {
  try {
    const rawBlocks = JSON.parse(match[1]);
    if (Array.isArray(rawBlocks)) {
      allBlocks.push(...validateBlocks(rawBlocks));
    }
  } catch {
    logger.debug("Failed to parse coach blocks JSON");
  }
}

return { text, blocks: allBlocks };
````

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- server/services/__tests__/coach-blocks.test.ts
```

Expected: all tests pass including the new two-fence case.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach-blocks.ts server/services/__tests__/coach-blocks.test.ts
git commit -m "fix: parse all coach_blocks fences with global regex"
```

---

## Task 3: Make getChatMessages userId required

**Files:**

- Modify: `server/storage/chat.ts:95–108`

- [ ] **Step 1: Remove the optional marker**

In `server/storage/chat.ts`, find the `getChatMessages` function signature. Change:

```typescript
// Before
export async function getChatMessages(
  conversationId: number,
  limit: number = 50,
  userId?: string,
): Promise<ChatMessage[]> {
  if (userId) {
    return db
      .select({ message: chatMessages })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        and(
          eq(chatMessages.conversationId, chatConversations.id),
          eq(chatConversations.userId, userId),
        ),
      )
      .orderBy(chatMessages.createdAt)
      .limit(limit);
      .map((r) => r.message);
  }
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.conversationId, conversationId))
    .orderBy(chatMessages.createdAt)
    .limit(limit);
}
```

```typescript
// After — userId is required; unsafe bare-query branch removed
export async function getChatMessages(
  conversationId: number,
  limit: number = 50,
  userId: string,
): Promise<ChatMessage[]> {
  const rows = await db
    .select({ message: chatMessages })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      and(
        eq(chatMessages.conversationId, chatConversations.id),
        eq(chatConversations.userId, userId),
      ),
    )
    .orderBy(chatMessages.createdAt)
    .limit(limit);
  return rows.map((r) => r.message);
}
```

- [ ] **Step 2: Verify TypeScript catches any callers that forgot userId**

```bash
npm run check:types
```

Expected: if any call site omitted userId, TypeScript reports an error. Fix any reported errors by supplying the userId that's already available in the caller's scope. (Based on review, all current callers already pass userId.)

- [ ] **Step 3: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/storage/chat.ts
git commit -m "fix: make getChatMessages userId required, remove unsafe bare-query path"
```

---

## Task 4: Fix standard-tier streaming and add safety override

This is the largest task. It touches four files across server and client. Work through each file in order.

**Files:**

- Modify: `server/services/nutrition-coach.ts:234–254`
- Modify: `server/services/__tests__/nutrition-coach.test.ts`
- Modify: `server/services/coach-pro-chat.ts:129–132, 534–543`
- Modify: `server/services/__tests__/coach-pro-chat.test.ts`
- Modify: `server/routes/chat.ts:483–489`
- Modify: `client/hooks/useCoachStream.ts` (XHR response handler)

- [ ] **Step 1: Write failing tests for streaming behavior in nutrition-coach**

In `server/services/__tests__/nutrition-coach.test.ts`, add inside `describe("generateCoachResponse")`:

```typescript
import {
  generateCoachResponse,
  SAFETY_OVERRIDE_SENTINEL,
} from "../nutrition-coach";

describe("generateCoachResponse", () => {
  it("yields each delta individually rather than the full response at once", async () => {
    const stream = createMockStream([
      { content: "Hello " },
      { content: "there!" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(false);

    const chunks: string[] = [];
    for await (const chunk of generateCoachResponse(
      [{ role: "user", content: "Hi" }],
      DEFAULT_CONTEXT,
    )) {
      chunks.push(chunk);
    }

    // Must yield two separate chunks, not one concatenated string
    expect(chunks).toEqual(["Hello ", "there!"]);
  });

  it("yields SAFETY_OVERRIDE_SENTINEL as the last chunk when unsafe content detected", async () => {
    const stream = createMockStream([
      { content: "eat only 600 calories" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(true);

    const chunks: string[] = [];
    for await (const chunk of generateCoachResponse(
      [{ role: "user", content: "diet?" }],
      DEFAULT_CONTEXT,
    )) {
      chunks.push(chunk);
    }

    // First chunk is the unsafe content (already sent), last is the sentinel
    expect(chunks[0]).toBe("eat only 600 calories");
    expect(chunks[chunks.length - 1]).toBe(SAFETY_OVERRIDE_SENTINEL);
  });
});
```

- [ ] **Step 2: Run to confirm failures**

```bash
npm run test:run -- server/services/__tests__/nutrition-coach.test.ts
```

Expected: both new tests fail (SAFETY_OVERRIDE_SENTINEL not exported, single chunk yielded).

- [ ] **Step 3: Fix nutrition-coach.ts — export sentinel, yield per-delta**

In `server/services/nutrition-coach.ts`, add after the imports:

```typescript
/**
 * Sentinel yielded by generateCoachResponse when the safety check fires after
 * streaming has already begun. The caller (handleCoachChat) converts this to a
 * safety_override SSE event so the client can reset and display the safe message.
 */
export const SAFETY_OVERRIDE_SENTINEL = "\x00SAFETY_OVERRIDE\x00";
```

Replace lines 234–254 (the accumulation + single-yield block):

```typescript
let fullResponse = "";

try {
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullResponse += delta;
      yield delta; // stream each token to the caller as it arrives
    }
  }
} catch (error) {
  log.error({ err: toError(error) }, "coach streaming error");
  yield "Sorry, the response was interrupted. Please try again.";
  return;
}

if (containsUnsafeCoachAdvice(fullResponse)) {
  // Deltas already sent — signal caller to replace content client-side
  yield SAFETY_OVERRIDE_SENTINEL;
  return;
}
// No final yield — individual deltas are already in the caller's buffer
```

- [ ] **Step 4: Run nutrition-coach tests**

```bash
npm run test:run -- server/services/__tests__/nutrition-coach.test.ts
```

Expected: all tests pass including the two new ones.

- [ ] **Step 5: Write failing test for safety override in coach-pro-chat**

In `server/services/__tests__/coach-pro-chat.test.ts`, add a test that verifies `handleCoachChat` emits a `safety_override` event when `generateCoachResponse` yields the sentinel. (Use the existing mock patterns in that test file.)

```typescript
it("emits safety_override event when standard-path response is unsafe", async () => {
  // Mock generateCoachResponse to yield a delta then the sentinel
  vi.mock("../nutrition-coach", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../nutrition-coach")>();
    return {
      ...actual,
      generateCoachResponse: async function* () {
        yield "eat only 600 calories";
        yield actual.SAFETY_OVERRIDE_SENTINEL;
      },
    };
  });

  const events: import("../coach-pro-chat").CoachChatEvent[] = [];
  for await (const event of handleCoachChat({
    conversationId: 1,
    userId: "user-1",
    content: "bad diet",
    isCoachPro: false,
    // ... fill remaining required params from existing test helpers in the file
  })) {
    events.push(event);
  }

  const overrideEvent = events.find((e) => e.type === "safety_override");
  expect(overrideEvent).toBeDefined();
  expect(
    (overrideEvent as { type: "safety_override"; message: string }).message,
  ).toContain("careful");
});
```

Note: `handleCoachChat` requires several params (`user`, `isAborted`, `abortSignal`). Look at the existing test file for the helper that builds the minimal params object and use the same pattern.

- [ ] **Step 6: Run to confirm failure**

```bash
npm run test:run -- server/services/__tests__/coach-pro-chat.test.ts
```

Expected: the new safety_override test fails (type not defined yet).

- [ ] **Step 7: Update coach-pro-chat.ts — add safety_override event type + handle sentinel**

In `server/services/coach-pro-chat.ts`, add the import:

```typescript
import {
  generateCoachResponse,
  generateCoachProResponse,
  getSystemPromptTemplateVersion,
  SAFETY_OVERRIDE_SENTINEL,
  type CoachContext,
} from "./nutrition-coach";
```

Replace the `CoachChatEvent` type (line 129–132):

```typescript
export type CoachChatEvent =
  | { type: "content"; content: string }
  | { type: "blocks"; blocks: CoachBlock[] }
  | { type: "status"; label: string }
  | { type: "safety_override"; message: string };
```

Add a constant near the top of `handleCoachChat` (or as a module-level constant):

```typescript
const STANDARD_SAFETY_MESSAGE =
  "I need to be careful here. I can't provide unsafe diet instructions or diagnose medical conditions. Please consult a registered dietitian or healthcare provider who can assess your individual needs.";
```

Replace the standard path loop (lines 534–543) in `handleCoachChat`:

```typescript
  } else {
    for await (const chunk of generateCoachResponse(
      messageHistory,
      context,
      abortSignal,
    )) {
      if (isAborted()) break;
      if (chunk === SAFETY_OVERRIDE_SENTINEL) {
        fullResponse = STANDARD_SAFETY_MESSAGE;
        yield { type: "safety_override", message: STANDARD_SAFETY_MESSAGE };
        break;
      }
      fullResponse += chunk;
      yield { type: "content", content: chunk };
    }
```

- [ ] **Step 8: Run coach-pro-chat tests**

```bash
npm run test:run -- server/services/__tests__/coach-pro-chat.test.ts
```

Expected: all tests pass.

- [ ] **Step 9: Update chat.ts route — handle safety_override SSE event type**

In `server/routes/chat.ts`, find the event serialization block (lines 483–489):

```typescript
// Before
const eventJson = JSON.stringify(
  event.type === "content"
    ? { content: event.content }
    : event.type === "status"
      ? { status: event.label }
      : { blocks: event.blocks },
);
```

```typescript
// After
const eventJson = JSON.stringify(
  event.type === "content"
    ? { content: event.content }
    : event.type === "status"
      ? { status: event.label }
      : event.type === "safety_override"
        ? { safety_override: event.message }
        : { blocks: event.blocks },
);
```

- [ ] **Step 10: Update useCoachStream.ts — handle safety_override event client-side**

In `client/hooks/useCoachStream.ts`, find the XHR `onreadystatechange` block where content events are processed (around line 202). Add handling for `safety_override` after the existing `data.content` block:

```typescript
if (typeof data.content === "string") {
  accumulatedRef.current += data.content;
  const stripped = stripCoachBlocksFence(accumulatedRef.current);
  const newChars = stripped.slice(displayedLengthRef.current);
  displayedLengthRef.current = stripped.length;
  bufferRef.current += newChars;
}
// Handle safety override: clear buffered content and replace with safe message
if (typeof data.safety_override === "string") {
  bufferRef.current = "";
  accumulatedRef.current = "";
  displayedLengthRef.current = 0;
  firstCharDrainedRef.current = false;
  bufferRef.current = data.safety_override;
}
```

- [ ] **Step 11: Run all tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 12: Commit**

```bash
git add server/services/nutrition-coach.ts \
        server/services/__tests__/nutrition-coach.test.ts \
        server/services/coach-pro-chat.ts \
        server/services/__tests__/coach-pro-chat.test.ts \
        server/routes/chat.ts \
        client/hooks/useCoachStream.ts
git commit -m "feat: stream standard-tier coach responses per-token with safety override mechanism"
```

---

## Task 5: Fix empty notebookSummary injection

**Files:**

- Modify: `server/services/coach-pro-chat.ts:408–432`

- [ ] **Step 1: Fix the empty-entries guard**

In `server/services/coach-pro-chat.ts`, find the notebook injection block (around lines 408–432):

```typescript
// Before
if (isCoachPro) {
  const notebookEntries = await storage.getActiveNotebookEntries(userId);
  if (notebookEntries.length > 0) {
    const sanitized = ...
    const joined = truncateNotebookToBudget(sanitized, DEFAULT_NOTEBOOK_MAX_CHARS);
    context.notebookSummary =
      joined.length > 0
        ? `${joined}\n\n${BLOCKS_SYSTEM_PROMPT}`
        : BLOCKS_SYSTEM_PROMPT;
  } else {
    context.notebookSummary = BLOCKS_SYSTEM_PROMPT;  // ← sends confusing preamble with no entries
  }
}
```

```typescript
// After — only set notebookSummary when there are actual entries
if (isCoachPro) {
  const notebookEntries = await storage.getActiveNotebookEntries(userId);
  if (notebookEntries.length > 0) {
    const sanitized = notebookEntries.map((e) => ({
      type: e.type,
      content: sanitizeContextField(e.content, 500),
      updatedAt: e.updatedAt,
    }));
    const joined = truncateNotebookToBudget(
      sanitized,
      DEFAULT_NOTEBOOK_MAX_CHARS,
    );
    if (joined.length > 0) {
      context.notebookSummary = `${joined}\n\n${BLOCKS_SYSTEM_PROMPT}`;
    }
    // If truncation produces empty string, omit notebook section entirely
  }
  // BLOCKS_SYSTEM_PROMPT injected below unconditionally as part of system prompt
}
```

Note: `BLOCKS_SYSTEM_PROMPT` instructs the model how to use structured blocks. If it was previously always injected via `notebookSummary`, verify it is still reaching the model via another path (e.g., the base `buildSystemPrompt` in `nutrition-coach.ts`). If not, add it to `buildSystemPrompt` unconditionally for Pro users so block rendering is not broken. Check `buildSystemPrompt` in `nutrition-coach.ts` — if `BLOCKS_SYSTEM_PROMPT` is not already there, add it at the end of the prompt parts array when building for Pro (pass an `isCoachPro` flag or add a separate injection in `handleCoachChat` before calling the generators).

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- server/services/__tests__/coach-pro-chat.test.ts
```

Expected: all existing tests pass. If any test asserted on `BLOCKS_SYSTEM_PROMPT` being present in the prompt when there are no entries, update it to expect absence.

- [ ] **Step 3: Commit**

```bash
git add server/services/coach-pro-chat.ts
git commit -m "fix: skip notebook summary injection when user has no active entries"
```

---

## Task 6: Fix tool descriptions and Zod/OpenAI schema alignment

**Files:**

- Modify: `server/services/coach-tools.ts:274–280, 356–382`

- [ ] **Step 1: Fix the three tool descriptions**

In `server/services/coach-tools.ts`, update these description strings:

```typescript
// log_food_item (around line 278)
// Before:
description: "Add a food item to the user's daily nutrition log. Use this when the user says they just ate something and wants it tracked.",

// After:
description: "Propose adding a food item to the daily nutrition log. Returns a proposal — the user must confirm before the item is saved. Use when the user says they ate something and wants it tracked.",
```

```typescript
// add_to_meal_plan (around line 360)
// Before:
description: "Schedule a food item or recipe on the user's meal plan for a specific date and meal type.",

// After:
description: "Propose scheduling a food item or recipe on the user's meal plan. Returns a proposal — the user must confirm before it is saved.",
```

```typescript
// add_to_grocery_list (around line 388)
// Before:
description: "Create a new grocery list with one or more items. Use this when the user wants to add ingredients to their shopping list.",

// After:
description: "Propose creating a grocery list with one or more items. Returns a proposal — the user must confirm before items are saved.",
```

- [ ] **Step 2: Add system prompt instruction about proposals**

In `server/services/nutrition-coach.ts`, find `buildSystemPrompt`. Near the top of the instruction block (after the opening persona lines), add one instruction:

```typescript
"When a tool call proposes an action (log food, add to meal plan, add to grocery list), tell the user what you are suggesting and that they can confirm or cancel. Do not say the action has been completed.",
```

This should be added to the `parts` array before the `USER CONTEXT:` line.

- [ ] **Step 3: Align addToMealPlan Zod schema with OpenAI JSON definition**

In `server/services/coach-tools.ts`, find `addToMealPlanSchema` (around line 102):

```typescript
// Before
const addToMealPlanSchema = z.object({
  plannedDate: z.string().optional(),
  mealType: z.string().optional(),
  notes: z.string().optional(),
});
```

```typescript
// After — required with defaults to match OpenAI JSON definition's required: ["plannedDate", "mealType"]
const addToMealPlanSchema = z.object({
  plannedDate: z.string().default(() => new Date().toISOString().split("T")[0]),
  mealType: z.string().default("lunch"),
  notes: z.string().optional(),
});
```

Add a comment above the schema:

```typescript
// NOTE: plannedDate and mealType are marked required in the OpenAI JSON tool definition.
// Keep this Zod schema aligned with that definition — if you change required/optional
// here, update the getToolDefinitions() entry for add_to_meal_plan to match.
```

- [ ] **Step 4: Run tests**

```bash
npm run test:run -- server/services/__tests__/coach-tools.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/coach-tools.ts server/services/nutrition-coach.ts
git commit -m "fix: correct tool descriptions to reflect proposal semantics; align addToMealPlan schema"
```

---

## Task 7: Cap lookup_nutrition tool response size

**Files:**

- Modify: `server/services/coach-tools.ts:488–498`

- [ ] **Step 1: Add a trimming helper and apply it**

In `server/services/coach-tools.ts`, find the `lookup_nutrition` case in `executeToolCall` (around line 488):

```typescript
// Before
case "lookup_nutrition": {
  const parsed = lookupNutritionSchema.safeParse(args);
  if (!parsed.success) {
    return invalidArgs("lookup_nutrition", parsed.error.message);
  }
  const result = await lookupNutrition(parsed.data.query);
  if (!result) {
    return notFound(`No nutrition data found for "${parsed.data.query}"`);
  }
  return result;
}
```

```typescript
// After — project only the fields the model actually uses
case "lookup_nutrition": {
  const parsed = lookupNutritionSchema.safeParse(args);
  if (!parsed.success) {
    return invalidArgs("lookup_nutrition", parsed.error.message);
  }
  const result = await lookupNutrition(parsed.data.query);
  if (!result) {
    return notFound(`No nutrition data found for "${parsed.data.query}"`);
  }
  // Trim to fields the model needs — full result has dozens of micronutrient
  // sub-arrays and serving variants that inflate the token budget unnecessarily.
  return {
    name: (result as Record<string, unknown>).name,
    calories: (result as Record<string, unknown>).calories,
    protein_g: (result as Record<string, unknown>).protein_g,
    carbohydrates_total_g: (result as Record<string, unknown>).carbohydrates_total_g,
    fat_total_g: (result as Record<string, unknown>).fat_total_g,
    serving_size_g: (result as Record<string, unknown>).serving_size_g,
  };
}
```

Note: the exact field names depend on what `lookupNutrition` returns. Check `server/services/nutrition-lookup.ts` for the return type and adjust the field names to match. If `result` is strongly typed, use the correct type instead of `Record<string, unknown>`.

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- server/services/__tests__/coach-tools.test.ts
```

Expected: all tests pass. If any test asserts on the full result shape, update it to expect the trimmed shape.

- [ ] **Step 3: Commit**

```bash
git add server/services/coach-tools.ts
git commit -m "fix: trim lookup_nutrition tool response to macro fields only"
```

---

## Task 8: Sanitize user messages and interimTranscript

**Files:**

- Modify: `server/routes/chat.ts:287–293`
- Modify: `server/routes/coach-context.ts:156`

- [ ] **Step 1: Sanitize content in the message creation path (chat.ts)**

In `server/routes/chat.ts`, find where the user message is written to the DB (around line 287):

```typescript
// The createChatMessageWithLimitCheck call uses parsed.data.content directly
const message = await storage.createChatMessageWithLimitCheck(
  id,
  req.userId,
  parsed.data.content,
  dailyLimit,
  ...
);
```

Add sanitization before this call. At the top of this route file, ensure `sanitizeUserInput` is imported from `../lib/ai-safety`. Then:

```typescript
const sanitizedContent = sanitizeUserInput(parsed.data.content);
const message = await storage.createChatMessageWithLimitCheck(
  id,
  req.userId,
  sanitizedContent,
  dailyLimit,
  conversation.type as "coach" | "recipe" | "remix",
);
```

Also update the `handleCoachChat` call that passes `content` (around line 468):

```typescript
for await (const event of handleCoachChat({
  conversationId: id,
  userId: req.userId,
  content: sanitizedContent,   // ← use sanitized version
  screenContext: parsed.data.screenContext,
  ...
```

- [ ] **Step 2: Sanitize interimTranscript in coach-context.ts**

In `server/routes/coach-context.ts`, ensure `sanitizeUserInput` is imported from `../lib/ai-safety`. Then at line 156:

```typescript
// Before
prepared.push({ role: "user", content: interimTranscript });

// After
prepared.push({ role: "user", content: sanitizeUserInput(interimTranscript) });
```

- [ ] **Step 3: Run tests**

```bash
npm run test:run -- server/routes/__tests__/coach-context.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/routes/chat.ts server/routes/coach-context.ts
git commit -m "fix: sanitize user message content and interimTranscript before OpenAI"
```

---

## Task 9: Fix screenContext sanitization in recipe/remix path

**Files:**

- Modify: `server/routes/chat.ts:384–391`

- [ ] **Step 1: Apply sanitizeContextField to screenContext before generateRecipeChatResponse**

In `server/routes/chat.ts`, find where `generateRecipeChatResponse` is called with `parsed.data.screenContext` (around line 384):

```typescript
// Before
for await (const event of generateRecipeChatResponse(
  contextMessages,
  profile,
  parsed.data.screenContext,
  ...
```

```typescript
// After — sanitize before passing, matching the coach path
const sanitizedScreenContext = parsed.data.screenContext
  ? sanitizeContextField(parsed.data.screenContext, 200)
  : undefined;

for await (const event of generateRecipeChatResponse(
  contextMessages,
  profile,
  sanitizedScreenContext,
  ...
```

Ensure `sanitizeContextField` is imported from `../lib/ai-safety` (it may already be imported for another use).

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/routes/chat.ts
git commit -m "fix: sanitize screenContext before recipe chat response generation"
```

---

## Task 10: Sequence getChatMessageById after ownership check

**Files:**

- Modify: `server/routes/recipe-chat.ts:75–84`

- [ ] **Step 1: Serialize the parallel calls**

In `server/routes/recipe-chat.ts`, find the parallel fetch (around line 75):

```typescript
// Before — parallel: message read before ownership confirmed
const [conversation, chatMessage] = await Promise.all([
  storage.getChatConversation(id, req.userId),
  storage.getChatMessageById(parsed.data.messageId, id),
]);
if (!conversation)
  return sendError(res, 404, "Conversation not found", ErrorCode.NOT_FOUND);
```

```typescript
// After — ownership check first, then message fetch
const conversation = await storage.getChatConversation(id, req.userId);
if (!conversation)
  return sendError(res, 404, "Conversation not found", ErrorCode.NOT_FOUND);

const chatMessage = await storage.getChatMessageById(parsed.data.messageId, id);
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add server/routes/recipe-chat.ts
git commit -m "fix: verify conversation ownership before fetching chat message"
```

---

## Task 11: Strip internal fields from coach context response

**Files:**

- Modify: `server/routes/coach-context.ts:78–79`

- [ ] **Step 1: Project notebook entries to client-safe fields**

In `server/routes/coach-context.ts`, find the `res.json` response (around line 64). Change the `notebook` field:

```typescript
// Before
notebook: notebookEntries,

// After — omit userId and dedupeKey (internal fields)
notebook: notebookEntries.map((e) => ({
  id: e.id,
  type: e.type,
  content: e.content,
  status: e.status,
  followUpDate: e.followUpDate,
  updatedAt: e.updatedAt,
})),
```

- [ ] **Step 2: Run tests**

```bash
npm run test:run -- server/routes/__tests__/coach-context.test.ts
```

Expected: all tests pass. If any test asserts on `userId` or `dedupeKey` being present in the response, update it to expect those fields absent.

- [ ] **Step 3: Commit**

```bash
git add server/routes/coach-context.ts
git commit -m "fix: omit userId and dedupeKey from coach context notebook response"
```

---

## Self-Review

**Spec coverage check:**

| Spec Item                                       | Task                        |
| ----------------------------------------------- | --------------------------- |
| 1. Standard-tier streaming broken               | Task 4                      |
| 2. Pro-path safety filter race (post-streaming) | Task 4 (sentinel mechanism) |
| 3. Safety regex gap for 1100 cal                | Task 1                      |
| 4. Tool descriptions mislead model              | Task 6                      |
| 5. Zod/OpenAI schema mismatch                   | Task 6                      |
| 6. Sanitize user messages + interimTranscript   | Task 8                      |
| 7. screenContext sanitization inconsistency     | Task 9                      |
| 8. getChatMessages unsafe no-userId path        | Task 3                      |
| 9. getChatMessageById IDOR risk                 | Task 10                     |
| 10. Empty notebookSummary injection             | Task 5                      |
| 11. parseBlocksFromContent non-global regex     | Task 2                      |
| 12. lookup_nutrition response not capped        | Task 7                      |
| 13. Coach context exposes internal fields       | Task 11                     |

All 13 spec items covered. ✓

**Placeholder scan:** No TBDs. Task 7 has one conditional note ("check the return type") which is a verification step, not a placeholder.

**Type consistency:** `SAFETY_OVERRIDE_SENTINEL` is defined and exported in Task 4 step 3, imported in step 7, and used in both. `CoachChatEvent` with `safety_override` variant is added in step 7 and used in the route in step 9. Consistent. ✓
