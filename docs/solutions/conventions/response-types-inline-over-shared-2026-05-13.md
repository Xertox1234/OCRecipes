---
title: Keep API Response Types Inline at the Call Site
track: knowledge
category: conventions
module: shared
tags: [typescript, types, api, architecture, shared-code]
applies_to: [client/screens/**/*.tsx, client/hooks/**/*.ts, shared/types/**/*.ts]
created: '2026-05-13'
---

# Keep API Response Types Inline at the Call Site

## Rule

Declare API response `type` aliases inline in the file that consumes the response. Do **not** centralize them in `shared/types/models.ts` (or any equivalent "shared response types" file).

## Smell patterns

- A `shared/types/models.ts` (or `apis.ts`, `responses.ts`) growing to include every endpoint's response shape.
- A response interface used by exactly one screen, exported from a shared file.
- PRs that change a response shape touch two files: the consumer and the shared types file.

## Why

A shared response-types file becomes a dumping ground:

```typescript
// ❌ shared/types/models.ts — accumulates every API shape
export interface ScannedItemResponse {
  /* ... */
}
export interface PaginatedResponse<T> {
  /* ... */
}
export interface DailySummaryResponse {
  /* ... */
}
// ...50 more
```

The harms compound:

- **Response shapes are implementation details of the consuming component.** They describe the contract this screen expects from this endpoint — not a domain primitive.
- **Tight coupling makes refactoring harder.** When the consumer changes, you also edit a remote file that other code reads.
- **Cognitive cost during reading.** Following the code from screen → API call → response shape requires a file hop.
- **Naming collisions.** Two endpoints both return a "User" — the shared file has to disambiguate (`AuthUser`, `ProfileUser`), even though each consumer only knew about one.

Keep the type next to the call:

```typescript
// ✅ client/screens/HistoryScreen.tsx
type ScannedItemResponse = {
  id: number;
  productName: string;
  scannedAt: string;
};

type PaginatedResponse = {
  items: ScannedItemResponse[];
  total: number;
};

const { data } = useQuery<PaginatedResponse>({
  queryKey: ["history"],
  queryFn: () => apiRequest("GET", "/api/history"),
});
```

When the shape changes, you update it where it's read. No remote-file churn.

## Exceptions

**Domain types that are genuinely shared across multiple consumers belong in `shared/`.** Auth is the canonical example:

```typescript
// shared/types/auth.ts — User and AuthResponse used by login screen, register screen,
// useAuth context, profile screen, and the server's response serializer
export interface User {
  /* ... */
}
export interface AuthResponse {
  token: string;
  user: User;
}
```

The test is **plurality of consumers**, not "this shape is reused once." A single consumer = inline. Three+ consumers reading the same shape from a stable contract = shared.

## Related Files

- `shared/types/auth.ts` — legitimate shared types (User, AuthResponse)
- `client/screens/HistoryScreen.tsx` — inline response types for screen-specific endpoints
- _(removed)_ `shared/types/models.ts` — deleted; was a response-type dumping ground

## See Also

- [inline-db-transaction-over-helper-2026-05-13.md](inline-db-transaction-over-helper-2026-05-13.md) — Same "inline over abstraction" principle applied to DB transactions.
