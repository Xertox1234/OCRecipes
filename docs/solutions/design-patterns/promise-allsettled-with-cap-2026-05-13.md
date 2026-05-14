---
title: "Promise.allSettled with cap for external API fan-out"
track: knowledge
category: design-patterns
tags: [api, external-api, concurrency, rate-limiting, fallback]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
---

# Promise.allSettled with cap for external API fan-out

## When this applies

Fan-out calls to paid / rate-limited external APIs (Spoonacular, USDA, API Ninjas) with a list of inputs where partial results are acceptable. Use `Promise.allSettled()` (not `Promise.all()`) with a cap on parallel calls — failed items degrade to the next tier instead of losing all results.

## Why

1. `Promise.all` rejects on the first failure, discarding successful results.
2. Sequential calls multiply latency linearly.
3. Uncapped parallelism can exhaust API quotas (Spoonacular free tier: 150 points/day).

The cap + `allSettled` gives parallel speed with quota protection and partial failure recovery.

## Examples

```typescript
const MAX_CALLS = 5;
const batch = ingredients.slice(0, MAX_CALLS);
const overflow = ingredients.slice(MAX_CALLS); // goes straight to fallback

const outcomes = await Promise.allSettled(
  batch.map(async (ingredient) => {
    const subs = await getSpoonacularSubstitutes(ingredient.name);
    return { ingredient, subs };
  }),
);

const results: Suggestion[] = [];
const needsFallback: Ingredient[] = [...overflow];

for (let i = 0; i < outcomes.length; i++) {
  const outcome = outcomes[i];
  if (outcome.status === "fulfilled" && outcome.value.subs.length > 0) {
    results.push(...formatSuggestions(outcome.value));
  } else {
    needsFallback.push(batch[i]); // degrade to AI tier
  }
}
```

```typescript
// Bad: sequential calls — 5 items × 10s timeout = 50s worst case
for (const item of items) {
  const result = await externalApi(item); // sequential
}

// Bad: Promise.all — one failure rejects everything
await Promise.all(items.map((item) => externalApi(item)));

// Good: parallel + partial failure recovery + quota protection
await Promise.allSettled(items.slice(0, MAX).map(...));
```

## Exceptions

- Internal database queries where all-or-nothing semantics are correct
- APIs with no rate limits where `Promise.all` is simpler

## Related Files

- `server/services/ingredient-substitution.ts` — 3-tier substitution pipeline (Static → Spoonacular → AI)

## See Also

- [Multi-source nutrition lookup chain](multi-source-nutrition-lookup-chain-2026-05-13.md)
- [Fetch timeout with AbortSignal for every external API call](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md)
