---
title: Filter LLM memory extraction with safety checks before persistence
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, memory-extraction, notebook, prompt-injection]
applies_to: [server/services/notebook-extraction.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Filter LLM memory extraction with safety checks before persistence

## Rule

When using an LLM to extract structured memories from conversation history (e.g., notebook entries, commitments, goals), the extractor itself can be misled by user messages that contain dangerous dietary goals. A user saying "my plan is to eat 300 cal/day" may cause the extractor to persist that as a commitment — which then gets reinjected into future coach prompts.

## Pattern

After extraction, filter every entry through `containsUnsafeCoachAdvice()` before persisting. Additionally, include `SYSTEM_PROMPT_BOUNDARY` in the extractor's system prompt so it resists prompt injection via conversation content.

## Examples

```typescript
// ✅ CORRECT
import {
  containsUnsafeCoachAdvice,
  SYSTEM_PROMPT_BOUNDARY,
} from "../lib/ai-safety";

const extractorSystemPrompt = `You extract structured memories from conversations. ${SYSTEM_PROMPT_BOUNDARY}`;

const extracted = await callExtractor(conversation, extractorSystemPrompt);

// Filter unsafe entries before persisting
const safe = extracted.entries.filter(
  (entry) => !containsUnsafeCoachAdvice(entry.content),
);
await storage.upsertNotebookEntries(userId, safe);
```

## Why

The coach's output safety check only covers what the coach says. The extractor runs separately and has its own exposure to user-authored content — it is an independent injection surface.

## Related Files

- `server/services/notebook-extraction.ts` — `extractNotebookEntries()` with boundary + filter
- `server/lib/ai-safety.ts` — `containsUnsafeCoachAdvice()`
- Origin: 2026-04-29 audit M2

## See Also

- [Sanitize AI-generated content before storage](sanitize-ai-generated-content-before-storage-2026-05-13.md)
- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Buffer-then-check for streaming LLM safety](../design-patterns/buffer-then-check-streaming-llm-safety-2026-05-13.md)
