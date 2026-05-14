---
title: "Early rejection before paid APIs"
track: knowledge
category: design-patterns
tags: [security, cost-control, validation, openai, ordering]
module: server
applies_to: ["server/routes/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# Early rejection before paid APIs

## When this applies

Place cheap validation (size checks, cap limits, permission gates) **before** expensive external calls (OpenAI Vision, nutrition APIs, Spoonacular).

## Examples

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

## Why

Saves API credits and reduces latency for requests that would be rejected anyway. Validate everything you can locally before incurring external costs.

## See Also

- [Bounded in-memory store pattern](bounded-in-memory-store-pattern-2026-05-13.md)
- [Rate limiting on external API endpoints](rate-limiting-external-api-endpoints-2026-05-13.md)
- [Premium-gate parity across endpoints hitting expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
