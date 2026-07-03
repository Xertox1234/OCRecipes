---
title: Sanitize all roles when replaying stored chat history
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, chat-history, prompt-injection, sanitization]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Sanitize all roles when replaying stored chat history

## Rule

When replaying stored chat history to an LLM, sanitize **every message role** — not just `"user"`. Stored `"assistant"` and `"system"` messages are also attack surfaces: a prior response could have been manipulated, or the DB row modified directly, leaving an injection payload that rides silently through every subsequent call.

Use role-aware sanitization: `sanitizeUserInput` (full injection filter) for user messages, `sanitizeContextField` (lighter, preserves recipe/nutritional content structure) for assistant and system messages.

## Examples

```typescript
// ❌ BAD: only user messages sanitized — assistant/system payloads pass through raw
const sanitizedMessages = conversationMessages.map((m) => ({
  role: m.role,
  content: m.role === "user" ? sanitizeUserInput(m.content) : m.content,
}));

// ✅ GOOD: all roles sanitized, strength matched to trust level
const sanitizedMessages = conversationMessages.map((m) => ({
  role: m.role,
  content:
    m.role === "user"
      ? sanitizeUserInput(m.content)
      : sanitizeContextField(m.content),
}));
```

## Why two different sanitizers

`sanitizeUserInput` strips aggressively (removes instruction-like phrases, boundary markers). `sanitizeContextField` is lighter — assistant messages legitimately contain recipe instructions and multi-line text that would be false-positived by the aggressive filter.

## When to use

Any service that maps stored `chatMessages` rows into the `messages` array for an OpenAI call. Check `conversationMessages.map(...)` — if the branch only sanitizes `"user"` role, extend it.

## When NOT to use

The system prompt you construct at call time (not stored in DB) — that's trusted code, not untrusted storage content.

## Related Files

- `server/services/recipe-chat.ts` — `sanitizedMessages` map covers all roles (M1, 2026-05-09)
- `server/lib/ai-safety.ts` — `sanitizeUserInput`, `sanitizeContextField`
- `docs/rules/security.md` — "Sanitize ALL prompt roles before sending to OpenAI"
- Origin: M1 audit finding (2026-05-09)

## See Also

- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Sanitize ALL user profile fields in AI prompts](sanitize-all-user-profile-fields-ai-prompts-2026-05-13.md)
- [Sanitize DB-sourced user content in AI prompts](sanitize-db-sourced-content-ai-prompts-2026-05-13.md)
