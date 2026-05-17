---
title: "Typed service errors need an explicit catch before handleRouteError"
track: knowledge
category: conventions
tags: [api, errors, error-handling, zod, services]
module: server
applies_to: ["server/routes/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-16
---

# Typed service errors need an explicit catch before handleRouteError

## Rule

When a service throws a **typed error** that must map to a non-500 status
(e.g. a 400 for invalid request state), the route's catch block must check
that error type **first** and only fall through to `handleRouteError` — or, if
the fall-through itself must stay 500, to a manual `logger.error` +
`sendError(500)` — afterward.

Do **not** route the whole catch through bare `handleRouteError` when the try
body can also throw a `ZodError` that should stay 500. `handleRouteError` maps
**every** `ZodError` to a 400 `VALIDATION_ERROR` response. That is correct for
request-body validation, but wrong for a `ZodError` raised **inside a service**
while validating an AI/external response — that is a server-side failure and
must remain 500.

```typescript
} catch (error) {
  // Explicit catch: maps EmptyPantryError → 400 before the generic 500 path.
  // Not using handleRouteError for the fall-through because aiResponseSchema
  // parse failures inside the service must stay 500 (server-side AI failure),
  // not be re-mapped to 400 by handleRouteError's ZodError arm.
  if (error instanceof EmptyPantryError) {
    sendError(res, 400, error.message, ErrorCode.VALIDATION_ERROR);
    return;
  }
  logger.error({ err: toError(error) }, "generate meal plan from pantry failed");
  sendError(res, 500, "Failed to generate meal plan", ErrorCode.INTERNAL_ERROR);
}
```

## When this applies

- A route delegates orchestration to a service, and the service throws a
  domain-specific `Error` subclass for an expected client-facing condition
  (empty pantry, quota exhausted, not found, etc.).
- The same service path also calls `schema.parse(...)` on an AI or external
  API response — a malformed response there throws a `ZodError` that should
  surface as 500, not 400.

If neither of those holds (no typed errors, no internal `parse`), the normal
project rule applies: use `handleRouteError(res, error, "context")`.

## Why

`handleRouteError` has a `ZodError`-first branch (`server/routes/_helpers.ts`)
that returns 400. It cannot distinguish a request-body `ZodError` from a
`ZodError` thrown by a service validating an upstream AI response. Sending the
whole catch through it would silently downgrade genuine server-side AI failures
to a 400, telling the client "your request was invalid" when it was not — and
breaking any caller that branches on status code.

A bare `handleRouteError` also has no way to map a typed error like
`EmptyPantryError` to 400; it would 500 instead. The explicit `instanceof`
check before the fall-through is the established pattern for both concerns.

## Examples

- `server/routes/meal-plan.ts` — `POST /api/meal-plan/generate-from-pantry`:
  `EmptyPantryError → 400`, everything else (including service-internal
  `aiResponseSchema.parse` failures) → 500.
- `server/services/pantry-meal-plan.ts` — defines `EmptyPantryError` and the
  `buildPantryMealPlanForUser` orchestrator that throws it.

## Related Files

- `server/routes/meal-plan.ts`
- `server/services/pantry-meal-plan.ts`
- `server/routes/_helpers.ts` — `handleRouteError` definition

## See Also

- `docs/solutions/conventions/api-error-response-structure-2026-05-13.md`
- `docs/rules/api.md` — "All catch blocks must use `handleRouteError`"
