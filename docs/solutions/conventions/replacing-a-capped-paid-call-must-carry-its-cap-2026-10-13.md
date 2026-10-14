---
title: When a feature replaces a capped paid call, re-establish the cap on the new path — the old limit often lived inside the step you removed
track: knowledge
category: conventions
module: server
tags: [ai-prompting, api, performance, quota, cost]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-10-13'
---

# Replacing a capped paid call must carry its cap

## Rule

When a feature swaps one paid upstream for another, find the old step's limit. Examples: Spoonacular search swapped for an AI listing plus 5–8 image generations. Then put an equivalent bound on the new path, enforced **before** any paid call and shared by every entry point that reaches it.

## Why

The Recipe Finder's online step was bounded only by `claimSpoonacularSearch`'s daily cap. Inspired recipes kept that claim but used it only to decide whether search titles feed the prompt, which is correct per the spec. As a result:
- Each `search_online` turn now cost an AI call plus 5 photos, with **no daily bound**.
- The Pro Coach limit is effectively unlimited (999999), so about 20 listings per minute were possible per user.
- The Recipe Browser route had only a per-minute limiter.

No task in the plan owned the cap, because no task "removed" it: it disappeared with the meaning of the claim.

## Examples

```ts
// shared/schemas/inspired-recipes.ts
export const INSPIRED_DAILY_CARD_CAP = 80; // rolling 24 h, Browser + Finder combined

// both entry points, before any search / AI / image call:
const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
if ((await storage.countInspiredSuggestionsSince(userId, since)) >= INSPIRED_DAILY_CARD_CAP) {
  // Browser route → 429 DAILY_LIMIT_REACHED; Finder step → { status: "unavailable" }
}
```

- Count **units of cost** (cards, each with a photo), not requests.
- Keep the check outside the shared service, so each surface can answer in its own way.
- A read-then-act check can overshoot by one listing under concurrency. That's fine for a cost guard.

## Exceptions

A per-minute rate limiter alone is not a daily bound. Pair it with a daily one whenever the call costs money.

## Related Files

- `server/routes/inspired-recipes.ts`, `server/services/recipe-finder/run-turn.ts`
- `server/storage/inspired-suggestions.ts` — `countInspiredSuggestionsSince`

## See Also

- [new-recipe-generation-endpoint-skipped-quota](../logic-errors/new-recipe-generation-endpoint-skipped-quota-2026-05-13.md) — a new endpoint that skipped the sibling's quota
- [per-conversation-quota-vs-per-message](../design-patterns/per-conversation-quota-vs-per-message-2026-05-13.md)
