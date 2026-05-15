---
title: "Match Existing API Response Conventions Before Adding New Ones"
track: knowledge
category: conventions
tags: [api, response-shape, error-handling, consistency, zod, code-review]
module: server
applies_to:
  ["server/routes/**/*.ts", "server/utils/**/*.ts", "shared/schemas/**/*.ts"]
created: 2026-05-13
---

# Match Existing API Response Conventions Before Adding New Ones

## Rule

Before introducing a helper that standardizes responses, check the existing
response format. A utility that deviates from the established convention
creates more inconsistency than it solves.

When in doubt, grep for `res.status(` and `res.json({` to see the existing
pattern, and reuse domain-specific Zod schemas instead of generic primitives
when validating response shapes.

## Smell patterns

- A new helper (`sendError`, `sendOk`, `sendApiResponse`) that adds extra
  envelope fields not present in existing routes.
- `success: true` / `success: false` envelopes in some endpoints but not
  others.
- `z.string()` used for a constrained value (e.g., a tier name, a status
  enum) where a domain schema like `subscriptionTierSchema` already exists.
- New endpoints that diverge from established error shape because the author
  didn't audit existing routes first.

## Why

Inconsistent response shapes force clients to special-case endpoints, defeat
shared parsing utilities, and quietly weaken type guarantees:

- A client that handles `{ error }` everywhere will not look for
  `{ success: false, error }` on the one endpoint that uses it — and so
  won't surface the error correctly.
- Validation schemas that use `z.string()` instead of the domain schema let
  invalid values pass on the client even when the server rejects them — the
  two layers should fail the same way for the same inputs.
- The "more information is better" instinct produces an envelope that always
  reports `success` redundantly with the HTTP status code already on the
  response.

## Examples

### Before — new helper adds extra field

```typescript
// Initial implementation
export function sendError(res: Response, status: number, error: string) {
  res.status(status).json({ success: false, error }); // Extra field
}
```

Every other error response in the codebase uses `{ error: "..." }` without a
`success` field. Adding `success: false` to subscription endpoints created
an inconsistency that clients would need to handle differently.

### After — matches the established convention

```typescript
export function sendError(
  res: Response,
  status: number,
  error: string,
  options?: ErrorOptions,
) {
  const body: Record<string, unknown> = { error };
  if (options?.code) body.code = options.code;
  res.status(status).json(body);
}
```

The HTTP status code already encodes success vs failure; the body adds the
explanation only.

### Schema reuse — prefer the domain schema

`UpgradeResponseSchema` initially used `z.string()` for the tier field:

```typescript
// BAD: client won't catch invalid tier strings the way the server does
const UpgradeResponseSchema = z.object({
  tier: z.string(),
  // ...
});
```

Replace the primitive with the existing domain schema:

```typescript
// GOOD: client and server both reject invalid tiers
import { subscriptionTierSchema } from "@shared/schemas/subscription";

const UpgradeResponseSchema = z.object({
  tier: subscriptionTierSchema,
  // ...
});
```

## Exceptions

- **Versioned endpoints.** A `/v2/...` endpoint can introduce a new shape
  deliberately. The shape diverges only with explicit version intent.
- **Streaming or binary responses.** Different envelope by design — don't
  shoehorn into the JSON-error shape.

## Related Files

- `server/utils/sendError.ts` — error response helper aligned to the
  codebase convention.
- `shared/schemas/subscription.ts` — `subscriptionTierSchema` (domain schema
  used by `UpgradeResponseSchema`).

## See Also

- [paired-endpoints-equal-safeguards](paired-endpoints-equal-safeguards-2026-05-13.md) —
  also from the subscription rollout; same instinct (don't drift between
  similar code paths).
- [input-validation-with-zod](input-validation-with-zod-2026-05-13.md) — reuse
  domain schemas at request boundaries.
