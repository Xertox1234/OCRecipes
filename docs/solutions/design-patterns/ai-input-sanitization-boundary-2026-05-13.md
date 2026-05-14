---
title: "AI input sanitization boundary (three-layer LLM safety)"
track: knowledge
category: design-patterns
tags: [security, ai-safety, prompt-injection, sanitization, openai]
module: server
applies_to: ["server/services/**/*.ts", "server/lib/ai-safety.ts"]
created: 2026-05-13
---

# AI input sanitization boundary (three-layer LLM safety)

## When this applies

Every AI service that accepts user text (chat, food parsing, photo analysis) and every AI service that returns structured data the app relies on.

## When NOT to use

- Internal-only AI calls where user text is not part of the prompt
- Non-AI text processing (use standard input validation instead)

## How it works

All user text that reaches an LLM passes through a three-layer safety boundary: input sanitization, system prompt boundary markers, and output validation.

## Examples

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

## Components

| Function                               | Purpose                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sanitizeUserInput(text)`              | Strips control characters, truncates to 2000 chars, replaces known injection patterns with `[filtered]` |
| `SYSTEM_PROMPT_BOUNDARY`               | Constant appended to system prompts instructing the LLM to ignore role-change requests                  |
| `validateAiResponse(response, schema)` | Validates LLM JSON output with `zod.safeParse()`, returns `null` on failure                             |
| `containsDangerousDietaryAdvice(text)` | Detects extreme calorie restriction, eating disorder promotion, dangerous supplement advice             |

## Why

LLMs are susceptible to prompt injection where user input can override system instructions. A dedicated sanitization module centralizes the defense so individual services do not need to reinvent it. Output validation with Zod prevents malformed LLM responses from crashing downstream code.

## Related Files

- `server/lib/ai-safety.ts` — all four exports
- `server/lib/__tests__/ai-safety.test.ts` — 28 test cases covering injection patterns and dietary advice detection
- `server/services/food-nlp.ts`, `server/services/nutrition-coach.ts`, `server/services/photo-analysis.ts` — consumers

## See Also

- [Sanitize ALL user profile fields in AI prompts](../conventions/sanitize-all-user-profile-fields-ai-prompts-2026-05-13.md)
- [Sanitize DB-sourced user content in AI prompts](../conventions/sanitize-db-sourced-content-ai-prompts-2026-05-13.md)
- [Sanitize all roles when replaying stored chat history](../conventions/sanitize-all-roles-stored-chat-history-2026-05-13.md)
- [Safety regex must exclude legitimate use](../conventions/safety-regex-exclude-legitimate-use-2026-05-13.md)
- [Buffer-then-check for streaming LLM safety](buffer-then-check-streaming-llm-safety-2026-05-13.md)
- [XML close-tag escaping in LLM prompts](xml-close-tag-escaping-llm-prompts-2026-05-13.md)
