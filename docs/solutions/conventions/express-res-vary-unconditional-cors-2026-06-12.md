---
title: 'Use res.vary(''Origin'') unconditionally in Express CORS middleware — never res.header(''Vary'', ...)'
track: knowledge
category: conventions
module: server
tags: [security, cors, http, middleware, express, caching]
applies_to: [server/index.ts, server/middleware/**/*.ts]
created: '2026-06-12'
---

# Use res.vary('Origin') unconditionally in Express CORS middleware — never res.header('Vary', ...)

## Rule

In any Express CORS handler, call `res.vary("Origin")` **before** the allowed-origin check, unconditionally on every response. Never use `res.header("Vary", "Origin")` as the setter.

## Why

**`res.header()` overwrites; `res.vary()` appends safely.**
If another middleware already set `Vary: Accept-Encoding`, calling `res.header("Vary", "Origin")` silently replaces it with `Vary: Origin`. `res.vary("Origin")` appends and deduplicates without destroying prior directives — it is the correct method for layered Express middleware.

**Unconditional placement prevents CDN cache poisoning.**
Placing the call inside the `if (isAllowedOrigin)` block means no-origin responses (mobile apps, curl) never receive a `Vary: Origin` header. A CDN that caches that response can then serve it to a browser origin that *would* need an `Access-Control-Allow-Origin` — poisoning the cache entry. Emitting `Vary: Origin` on every response tells the CDN to always cache per-origin, regardless of whether the ACAO header was set.

## Examples

**Wrong — overwrites prior Vary headers; conditional; setter semantics:**

```ts
if (isAllowedOrigin(origin)) {
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin"); // ← overwrites; only fires for allowed origins
  }
}
```

**Correct — append-safe; fires unconditionally:**

```ts
res.vary("Origin"); // ← unconditional; appends safely

if (isAllowedOrigin(origin)) {
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // ...
}
```

## Related Files

- `server/index.ts` — `setupCors()` (fixed 2026-06-12, PR from `todo/P3-2026-06-10-web-frontend-cors-origin`)

## See Also

- [cors-pattern-matching-not-wildcard-2026-05-13.md](cors-pattern-matching-not-wildcard-2026-05-13.md) — never combine wildcard ACAO with credentials
- [../logic-errors/cors-origin-trailing-slash-silent-mismatch-2026-06-12.md](../logic-errors/cors-origin-trailing-slash-silent-mismatch-2026-06-12.md) — validate WEB_ORIGIN has no trailing slash
