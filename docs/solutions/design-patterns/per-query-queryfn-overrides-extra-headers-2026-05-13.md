---
title: Per-query queryFn overrides for extra headers
track: knowledge
category: design-patterns
module: client
tags: [api, tanstack-query, headers, client, fetch]
applies_to: [client/hooks/**/*.ts, client/lib/query-client.ts]
created: '2026-05-13'
---

# Per-query queryFn overrides for extra headers

## When this applies

Override `queryFn` on a specific `useQuery` call only when that endpoint needs a request-level header that the global `getQueryFn` does not send. Do not extend `getQueryFn` with endpoint-specific headers; do not use `apiRequest` (which doesn't go through `useQuery`).

## Why

The default `getQueryFn` in `client/lib/query-client.ts` only sends `Authorization`. Any endpoint that also requires a context header (e.g. `X-User-Hour` for the carousel) must supply its own `queryFn` — silently omitting it causes the header to never be sent and the server to fall back to its own context.

## Examples

```typescript
export function useCarouselRecipes() {
  return useQuery<CarouselResponse>({
    queryKey: CAROUSEL_KEY,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const baseUrl = getApiUrl();
      const url = new URL("/api/carousel", baseUrl);

      const headers: Record<string, string> = {
        "X-User-Hour": String(new Date().getHours()),
      };

      const token = await tokenStorage.get();
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(`${res.status}: ${text}`);
      }
      return res.json() as Promise<CarouselResponse>;
    },
  });
}
```

## Maintenance hazard

The custom `queryFn` duplicates URL construction, auth-header injection, and error handling from `getQueryFn`. Changes to global patterns (e.g. new auth scheme, telemetry header) won't propagate automatically. When adding a new per-query `queryFn`, explicitly copy the latest `getQueryFn` body and add your header on top.

## Server side

Validate and parse the header defensively — never assume a valid value. Reject floats, out-of-range values, and non-numeric strings, falling back to server context:

```typescript
const rawHour = req.headers["x-user-hour"];
let userHour: number | undefined;
if (typeof rawHour === "string" && rawHour !== "") {
  const parsed = Number(rawHour);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) {
    userHour = parsed;
  }
}
```

## Related Files

- `client/hooks/useCarouselRecipes.ts` — per-query `queryFn` with `X-User-Hour`
- `server/routes/carousel.ts` — header parsing and validation
- `client/lib/query-client.ts` — `getQueryFn` (the default, auth-only implementation)

## Origin

Carousel timezone fix (2026-05-09).
