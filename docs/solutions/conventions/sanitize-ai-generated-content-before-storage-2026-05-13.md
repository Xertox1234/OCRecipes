---
title: Sanitize AI-generated content before storage
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, storage, sanitization, defense-in-depth]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Sanitize AI-generated content before storage

## Rule

Even when the storage layer uses parameterized queries (preventing SQL injection) and the display layer doesn't interpret HTML (React Native `<Text>`), apply `sanitizeContextField()` to AI-generated content before writing to the database. This is defense-in-depth — the content may later be consumed by contexts that DO interpret special characters (web views, email templates, API responses).

## Examples

```typescript
// ❌ BAD — AI output stored as-is
const entries = await extractNotebookEntries(messages, userId, conversationId);
await storage.createNotebookEntries(
  entries.map((e) => ({ ...e, content: e.content })), // raw AI output
);

// ✅ GOOD — sanitize before storage
import { sanitizeContextField } from "../lib/ai-safety";

const entries = await extractNotebookEntries(messages, userId, conversationId);
await storage.createNotebookEntries(
  entries.map((e) => ({ ...e, content: sanitizeContextField(e.content, 500) })),
);
```

## When to use

Any pipeline where AI-generated text is written to the database, especially if that content is later served in API responses or displayed in contexts beyond the originating client.

## Related Files

- `server/services/notebook-extraction.ts` — sanitizes extracted notebook entries
- `server/lib/ai-safety.ts` — `sanitizeContextField()` strips zero-width chars, control chars, and injection patterns
- Origin: Coach Pro code review (2026-04-10) — caught as Critical finding (C2)

## See Also

- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Filter LLM memory extraction with safety checks before persistence](filter-llm-memory-extraction-safety-checks-2026-05-13.md)
