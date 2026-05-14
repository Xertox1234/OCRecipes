---
title: "Zod safeParse for external API responses"
track: knowledge
category: conventions
tags: [api, zod, external-api, validation, type-safety]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
---

# Zod safeParse for external API responses

## Rule

When consuming JSON from external APIs (payment providers, third-party services, OAuth endpoints), validate the response shape with a Zod schema using `safeParse()` instead of casting with `as`. External APIs can change their response format without warning, and `as` casts provide zero runtime protection.

## Why

During the receipt-validation code review, three `as` casts on Google API and Apple JWS payloads were replaced with Zod schemas. This catches API-breaking changes at the validation boundary rather than letting invalid data propagate into business logic. Define the schema next to the function that consumes the response, use `safeParse()` (not `parse()`) so you can return a structured error instead of throwing, and keep schemas minimal — only validate fields you actually use.

## Examples

```typescript
import { z } from "zod";

// Define a schema for the expected response shape
const googleOAuthResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
});

// Good: safeParse validates the shape at runtime
const raw = await response.json();
const parsed = googleOAuthResponseSchema.safeParse(raw);
if (!parsed.success) {
  console.error("Unexpected API response shape:", parsed.error);
  return { valid: false, errorCode: "STORE_API_ERROR" };
}
// parsed.data is now typed and validated
const token = parsed.data.access_token;
```

```typescript
// Bad: as cast trusts the API response blindly
const data = (await response.json()) as {
  access_token: string;
  expires_in: number;
};
// If Google changes the response, `data.access_token` is undefined
// and the error surfaces far from where the data was received
```

## When to use

- Any `response.json()` from an external API (Google Play, Apple App Store, Spoonacular, USDA, etc.)
- Decoded payloads from JWS/JWT tokens
- Webhook payloads from third-party services

## Exceptions

- Internal API responses where you control the server (use shared types instead)
- Responses already validated by a client SDK that provides typed results

## Related Files

- `server/services/receipt-validation.ts` — `appleTransactionSchema`, `googleOAuthResponseSchema`, `googleSubscriptionResponseSchema`
- `server/services/recipe-catalog.ts` — `catalogSearchResponseSchema`, `recipeDetailSchema`
- `server/services/nutrition-lookup.ts` — `apiNinjasResponseSchema`, `usdaResponseSchema`

## See Also

- [Input validation with Zod](input-validation-with-zod-2026-05-13.md)
- [Unsafe type cast — use Zod validation instead of 'as'](../runtime-errors/unsafe-type-cast-zod-validation.md)
- [Zod union + transform for LLM output flexibility](../design-patterns/zod-union-transform-llm-output-2026-05-13.md)
