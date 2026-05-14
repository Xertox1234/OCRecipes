---
title: "Graceful 404 handling with raw fetch (bypass apiRequest throw)"
track: knowledge
category: design-patterns
tags: [api, fetch, 404, error-handling, client]
module: client
applies_to: ["client/screens/**/*.tsx", "client/hooks/**/*.ts"]
created: 2026-05-13
---

# Graceful 404 handling with raw fetch (bypass apiRequest throw)

## When this applies

Any endpoint where specific non-2xx status codes represent valid application states rather than errors (404 = "not found, try manual search", 409 = "already exists", etc.). The shared `apiRequest()` helper calls `throwIfResNotOk()` which throws on every non-2xx — bypass it by using raw `fetch` so you can inspect the body.

## Why

A shared `apiRequest()` helper that throws on all non-2xx responses is a good default — it pushes error handling into TanStack Query's `error` state and keeps happy-path code straight-line. But for endpoints where 404 is an expected outcome (barcode not in database, optional resource lookup), throwing is the wrong default; the UI should show a "try manual search" prompt, not an error toast.

## Examples

```typescript
// apiRequest() calls throwIfResNotOk() which throws on 404
// For barcode lookup, 404 means "product not in database" — not an error

const baseUrl = getApiUrl();
const token = await tokenStorage.getToken();
const response = await fetch(`${baseUrl}/api/nutrition/barcode/${barcode}`, {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const data = await response.json();

if (data.notInDatabase) {
  setShowManualSearch(true); // Expected path, not an error
}
```

## Related Files

- `client/screens/NutritionDetailScreen.tsx` — `fetchBarcodeData()`

## See Also

- [apiRequest never returns non-OK — don't re-check res.ok](../code-quality/api-request-never-returns-non-ok-dead-code-2026-05-13.md)
