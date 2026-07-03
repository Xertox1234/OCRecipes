---
title: 'Feature-flag routing divergence: mock the function the tier actually triggers'
track: knowledge
category: conventions
module: server
tags: [testing, vitest, premium, subscription, routes, mocks]
applies_to: [server/routes/**/__tests__/**/*.ts]
created: '2026-05-13'
---

# Feature-flag routing divergence: mock the function the tier actually triggers

## Rule

When premium tier checks create routing forks in handlers, tests must mock the function matching the code path their mocked tier triggers. Mocking `tier: "premium"` but only stubbing the free-tier function is a common source of 503/500 errors in tests.

## Examples

```typescript
// Route handler branches on premium tier:
const isCoachPro = !!features.coachPro;
if (isCoachPro) {
  for await (const chunk of generateCoachProResponse(...)) { ... }
} else {
  for await (const chunk of generateCoachResponse(...)) { ... }
}
```

```typescript
// ❌ BAD — test mocks premium tier but only stubs the free-tier function
vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({ tier: "premium" });
vi.mocked(generateCoachResponse).mockReturnValue(fakeStream()); // never called!

// ✅ GOOD — mock the function matching the premium code path
vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({ tier: "premium" });
vi.mocked(generateCoachProResponse).mockReturnValue(fakeStream());
```

## When this applies

Any test that mocks subscription tier and exercises a route with tier-dependent branching (coach, recipe generation, meal suggestions).

## Why

The free-tier mock never executes when the route reads `features.coachPro === true` and forks to the Pro function. The test gets 503/500 because the Pro function is unmocked (returns `undefined` instead of an async stream).

## Related Files

- `server/routes/__tests__/chat.test.ts` — streaming tests use `generateCoachProResponse` for premium tier
- `shared/types/premium.ts` — `TIER_FEATURES` maps tiers to feature booleans

**Origin:** Coach Pro test failures (2026-04-10) — 7 chat tests returned 503 because premium tier routed to `generateCoachProResponse` but only `generateCoachResponse` was mocked.

## See Also

- [Premium-gate parity across endpoints hitting expensive AI paths](premium-gate-parity-expensive-ai-paths-2026-05-13.md)
