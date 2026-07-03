---
title: Buffer-then-check for streaming LLM safety
track: knowledge
category: design-patterns
module: server
tags: [security, ai-safety, streaming, llm, safety-check]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Buffer-then-check for streaming LLM safety

## When this applies

When a service streams an LLM response token-by-token, safety regex patterns **cannot be applied to individual chunks** — an unsafe phrase like `"you likely have diabetes"` or a calorie recommendation below the threshold can straddle multiple chunks and only form completely in the accumulated buffer.

## Pattern

Collect the full response into a buffer before yielding any content, then run `containsUnsafeCoachAdvice()` once. On violation, yield the refusal message instead of the buffered text.

## Examples

```typescript
// ✅ CORRECT — buffer full response, check once
let fullResponse = "";
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta) fullResponse += delta;
}

if (containsUnsafeCoachAdvice(fullResponse)) {
  yield "I can't provide unsafe diet instructions or diagnose medical conditions. Please consult a healthcare provider.";
  return;
}
yield fullResponse;

// ❌ WRONG — scanning individual chunks misses cross-chunk patterns
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta?.content;
  if (delta && !containsUnsafeCoachAdvice(delta)) yield delta; // "you likely" passes; "have diabetes" passes; full phrase is never caught
}
```

## When to use

Any streaming LLM response path where the content is safety-critical (medical context, nutrition advice, dietary restrictions). Accept the latency tradeoff — users see the full response or the refusal, never a partial response cut off mid-sentence.

## When NOT to use

Non-safety-critical streaming where partial display is acceptable (recipe text, general descriptions).

## Related Files

- `server/services/nutrition-coach.ts` — `generateCoachResponse` and `generateCoachProResponse` — buffered streaming + `containsUnsafeCoachAdvice` check
- `server/lib/ai-safety.ts` — `containsUnsafeCoachAdvice()`, `containsDangerousDietaryAdvice()`, `containsUnsafeMedicalAdvice()`
- Origin: 2026-04-29 audit H1

## See Also

- [AI input sanitization boundary](ai-input-sanitization-boundary-2026-05-13.md)
- [Safety regex must exclude legitimate use](../conventions/safety-regex-exclude-legitimate-use-2026-05-13.md)
