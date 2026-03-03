---
title: "Add timeouts to OpenAI API calls"
status: done
priority: high
created: 2026-02-27
updated: 2026-02-27
resolved: 2026-02-27
assignee:
labels: [reliability, server, services, external-api]
---

# Add Timeouts to OpenAI API Calls

## Summary

Six service files make OpenAI API calls with no explicit timeout. The SDK default is 10 minutes — a stuck response holds an Express request handler open the entire time. All external API calls should have a reasonable timeout (30-60s).

## Background

The project already follows good timeout practices for other external APIs — `nutrition-lookup.ts` uses `FETCH_TIMEOUT_MS = 10000` and `receipt-validation.ts` uses `AbortSignal.timeout()`. But all OpenAI calls rely on the SDK's default 10-minute timeout.

The OpenAI Node SDK supports a `timeout` option on individual requests or at the client level.

## Affected Files

| File | Call Type | Suggested Timeout |
|------|-----------|-------------------|
| `server/services/photo-analysis.ts` (L149, L228) | Vision analysis + follow-up | 45s |
| `server/services/menu-analysis.ts` (L122) | Vision menu scan | 45s |
| `server/services/nutrition-coach.ts` (L91) | Chat completion | 30s |
| `server/services/food-nlp.ts` | Text parsing | 15s |
| `server/services/recipe-generation.ts` (L142) | Recipe generation | 60s |
| `server/services/meal-suggestions.ts` (L158) | Meal suggestions | 45s |

## Acceptance Criteria

- [ ] All 6 service files have explicit timeouts on OpenAI calls
- [ ] Timeouts are defined as named constants (e.g., `OPENAI_TIMEOUT_MS`)
- [ ] Timeout errors are caught and return user-friendly error messages (not raw SDK errors)
- [ ] Consider a shared constant in `server/lib/openai.ts` for the default timeout
- [ ] All existing tests pass

## Implementation Notes

### Option A: Per-request timeout

```typescript
const response = await openai.chat.completions.create(
  { model: "gpt-4o", messages, max_tokens: 1000 },
  { timeout: 30_000 } // 30 seconds
);
```

### Option B: Client-level default

In `server/lib/openai.ts`:
```typescript
export const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "",
  timeout: 45_000, // 45 second default
});
```

Option B is simpler — set a sensible default at the client level, then override per-call only where needed (e.g., recipe generation may need longer).

### Also fix: `max_tokens` → `max_completion_tokens`

While touching these files, migrate from the deprecated `max_tokens` parameter to `max_completion_tokens` for newer model families. This is a one-line change per call site.

### Also fix: Empty API key fallback

In `server/lib/openai.ts`, the `?? ""` fallback silently initializes the SDK with an empty key. Change to throw or log a clear warning at startup:

```typescript
const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
if (!apiKey) {
  console.warn("AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features will fail");
}
export const openai = new OpenAI({ apiKey: apiKey ?? "", ... });
```

## Dependencies

- None

## Risks

- Timeout too aggressive → legitimate slow responses get cut off (vision analysis can take 15-30s)
- Timeout too lenient → still holds connections too long
- Start with 45s default, monitor, and adjust

## Updates

### 2026-02-27
- Initial creation from codebase audit
