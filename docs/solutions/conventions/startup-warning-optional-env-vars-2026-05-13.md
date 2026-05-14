---
title: "Log a startup warning for optional env vars with rate-limited fallbacks"
track: knowledge
category: conventions
tags: [api, env, startup, observability]
module: server
applies_to: ["server/**/*.ts"]
created: 2026-05-13
---

# Log a startup warning for optional env vars with rate-limited fallbacks

## Rule

For optional environment variables that fall back to a demo/free-tier value with significant limitations, log a `console.warn` at module load time. Silent fallbacks produce surprises in production.

## Why

Silent fallbacks cause unexpected failures in production — a developer who never set `USDA_API_KEY` may not realize the server is running against the 40-requests-per-hour `DEMO_KEY` until users start seeing failures. A startup warning ensures operators are aware of the limitation.

## Examples

```typescript
// Good: Warn at startup when using rate-limited fallback
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  console.warn(
    "⚠️  USDA_API_KEY not set - using DEMO_KEY with 40 requests/hour limit",
  );
}

async function lookupUSDA(query: string): Promise<NutritionData | null> {
  // Use USDA_API_KEY here - no runtime check needed
}
```

```typescript
// Bad: Silent fallback - production surprises
const usdaApiKey = process.env.USDA_API_KEY || "DEMO_KEY";
// No warning - developers don't know they're using a rate-limited key
```

## When to use

- External API keys with free tier / demo key fallbacks
- Rate-limited fallback values
- Any optional config where the fallback has significant limitations

## See Also

- [Fail-fast environment validation at module load](fail-fast-environment-validation-2026-05-13.md)
- [Centralized environment validation with Zod schema](../design-patterns/centralized-env-validation-zod-2026-05-13.md)
