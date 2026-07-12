---
title: Variant-gated prompt lines must be static per variant, and the template-version hash must render every variant combination
track: knowledge
category: conventions
tags: [prompt-engineering, caching, template-hash, coach, tiers]
module: server
applies_to: ["server/services/nutrition-coach.ts", "server/services/coach-pro-chat.ts"]
created: 2026-07-12
---

# Variant-gated prompt lines must be static per variant, and the template-version hash must render every variant combination

## Rule

When a system prompt gains a static gating dimension (free/pro tier, intent bundle):

1. **Lines gated on the variant flag must be static per variant** — always emitted for that variant, never additionally conditional on runtime context. Data-driven content belongs in context fields captured by the context hash (`hashCoachCacheContext`); instructions belong in the template.
2. **The template-version hash must render the full cross-product of variants** — for the Coach, 4 intents × 2 tiers = 8 `buildSystemPrompt` calls joined into one hash. A variant left out of the hash means edits to its prose no longer invalidate cached responses.

## Smell patterns

- `tier === "pro" && context.someField` guarding an *instruction* line — a data-conditional instruction is invisible to both hashes.
- `getSystemPromptTemplateVersion` iterating intents but not the new dimension after a tier/persona split.

## Why

The response cache key's first component is the template hash; the rest is the context hash. This split is only sound if every byte of prompt prose is a pure function of (intent, tier) and every data byte is a pure function of hashed context fields. Break either side and same-day cache entries serve prompts the current code no longer produces. Corollary: the hash inputs must stay deterministic — fixed `TEMPLATE_REFERENCE_TIME` and fixed `tz: "UTC"` in the version renderer.

## Exceptions

Data-conditional *sections* (render a block only when the context field exists) are fine — that's the context-hash side — as long as the instructional wording inside is constant and the field is in `hashCoachCacheContext`.

## Related Files

- `server/services/nutrition-coach.ts` — `BuildPromptOptions.tier`, `getSystemPromptTemplateVersion` 8-variant hash
- `server/services/coach-pro-chat.ts` — `hashCoachCacheContext` (context side of the split)

## See Also

- [../logic-errors/cache-affecting-fields-out-of-sync-2026-05-13.md](../logic-errors/cache-affecting-fields-out-of-sync-2026-05-13.md) — the context-hash sibling rule this extends to the template side
