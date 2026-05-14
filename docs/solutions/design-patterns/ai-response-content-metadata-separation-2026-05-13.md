---
title: "AI response content/metadata separation (strip JSON fence before persist)"
track: knowledge
category: design-patterns
tags: [api, ai, sse, recipe-remix, parsing, persistence]
module: server
applies_to: ["server/routes/**/*.ts", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# AI response content/metadata separation (strip JSON fence before persist)

## When this applies

Any feature where the LLM streams a response that mixes conversational text with a structured ` ```json ` block — recipe remix, ingredient extraction, meal plan text summaries.

## Why

The code fence is display noise — the structured data already lives in `metadata`. Storing the unstripped content means the conversational column contains JSON artefacts that surface on replay.

## Storage split

- **`content` column** — only conversational text. Strip any ` ```json...``` ` block before inserting.
- **`metadata` column** — parsed JSON object (recipe, nutrition summary, etc.).

## Examples

````typescript
// server/routes/chat.ts — strip fence before persisting (full response available)
const conversationalText = fullTextResponse
  .replace(/\n*```json[\s\S]*?```\s*/g, "")
  .trim();
await storage.createChatMessage(
  conversationId,
  userId,
  "assistant",
  conversationalText || "Here's a recipe for you!",
  metadata, // structured data already extracted from the fence
);
````

## Asymmetric regex

The stripping regex is intentionally different between the client streaming display and the server persist step:

| Context                    | Regex                                              | Reason                                                        |
| -------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Client (streaming display) | `/\n*```json[\s\S]*$/` (greedy-to-EOF)             | Stream is mid-flight; the closing ` ``` ` has not yet arrived |
| Server (before persist)    | `/\n*```json[\s\S]*?```\s*/g` (lazy, closed fence) | Full response is available; match only the complete block     |

````typescript
// Client — strip mid-flight during streaming display
const streamingDisplayContent = streamingContent
  .replace(/\n*```json[\s\S]*$/, "")
  .trimEnd();
````

## Filter system messages at the display layer

AI context passed as `role: "system"` (e.g., the source recipe JSON for a remix) is setup context, not user-visible output. Filter it in the `displayMessages` memo before rendering:

```typescript
// Good: never render system messages
const msgs = messages.filter((m) => m.role !== "system");

// Bad: render all roles, hoping system content is empty or invisible
```

## Exceptions

Fully structured endpoints (no conversational prose) where the entire response body is JSON — those don't need stripping.

## Related Files

- `server/routes/chat.ts` — recipe remix SSE route: `conversationalText` strip before persist
- `client/screens/RecipeChatScreen.tsx` — streaming display strip + `role !== "system"` filter

## Origin

Recipe Remix bug fix (2026-05-01).

## See Also

- [Always guard JSON.parse on LLM output](../conventions/always-guard-json-parse-llm-output-2026-05-13.md)
- [Per-conversation quota (vs per-message) for iterative AI sessions](per-conversation-quota-vs-per-message-2026-05-13.md)
