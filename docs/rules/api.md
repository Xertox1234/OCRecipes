# API Rules

- All catch blocks must use `handleRouteError(res, error)` — never custom `res.status(500).json(...)` responses
- Exception: when a service throws a typed error that must map to a non-500 status (e.g. `EmptyPantryError` → 400), check it with `instanceof` first; only route the fall-through through `handleRouteError` if the try body cannot throw a service-internal `ZodError` that must stay 500 (`handleRouteError` maps every `ZodError` to 400)
- All route module exports must be named `register` — not `registerXRoutes` or `registerXHandlers` (breaks grep across 50+ route modules)
- All request bodies must be Zod-validated before field access — use `const parsed = schema.safeParse(req.body)`
- `req.userId` is a UUID string — never `parseInt(req.userId)` (returns NaN for UUIDs)
- New endpoints that call OpenAI or run expensive compute must have a rate limiter applied before the handler
- When adding a premium-gated write endpoint, always check whether the corresponding read endpoint also needs gating
