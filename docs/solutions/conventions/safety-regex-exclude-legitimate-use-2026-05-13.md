---
title: Safety regex must exclude legitimate use
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, regex, false-positives, dietary-advice]
applies_to: [server/lib/ai-safety.ts]
created: '2026-05-13'
---

# Safety regex must exclude legitimate use

## Rule

`containsDangerousDietaryAdvice()` scans AI output for dangerous patterns via regex. When adding new patterns, **always verify they don't match the coach's own safe advice.** The coach's streaming safety check (`nutrition-coach.ts`) runs these patterns against the response _it is generating_ — a false positive triggers a mid-response disclaimer that confuses users.

## Examples

```typescript
// ❌ BAD: Catches "16-hour fast" (standard IF) and "just eat 1800 cal" (safe)
/\d+[- ](?:hour|hr)\s+(?:water\s+)?fast/i
/(?:only|just)\s+(?:eat|consume|have)\s+[1-9]\d{2,3}\s*cal/i

// ✅ GOOD: Scoped to dangerous ranges only
/(?:2[4-9]|[3-9]\d|\d{3,})[- ](?:hour|hr)\s+(?:water\s+)?fast/i  // 24+ hours only
/(?:only|just)\s+(?:eat|consume|have)\s+(?:[1-9]\d{2}|1[01]\d{2})\s*cal/i  // 100-1199 only
```

## When adding safety regex

Test against both dangerous examples AND the coach's expected safe responses. The eval framework (`npm run eval:coach`) can reveal false positives — if the safety dimension scores drop after a regex change, check for false triggers.

## Why

A safety classifier that fires on safe advice is worse than no classifier — it inserts mid-response disclaimers that break the user experience and erode trust. Scope regex numeric ranges to genuinely dangerous values; a "16-hour fast" is standard intermittent fasting, not a medical emergency.

## Related Files

- `server/lib/ai-safety.ts` — `DANGEROUS_DIETARY_PATTERNS` array
- `server/lib/__tests__/ai-safety.test.ts` — test against false positives here

## See Also

- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Deterministic safety classifier regex gotchas](safety-classifier-regex-gotchas-2026-05-13.md)
- [Buffer-then-check for streaming LLM safety](../design-patterns/buffer-then-check-streaming-llm-safety-2026-05-13.md)
