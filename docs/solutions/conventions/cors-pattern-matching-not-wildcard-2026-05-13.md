---
title: "CORS with pattern matching, never wildcard with credentials"
track: knowledge
category: conventions
tags: [security, cors, http, middleware]
module: server
applies_to: ["server/index.ts", "server/middleware/**/*.ts"]
created: 2026-05-13
---

# CORS with pattern matching, never wildcard with credentials

## Rule

Use origin pattern matching instead of wildcard `*` for CORS. Never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true` — browsers reject this combination, and it signals an intent error. Only set CORS headers for allowed origins.

## Examples

```typescript
// ✅ GOOD: Only reflect specific origins; keep all CORS headers inside the allowed block
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ❌ BAD: Wildcard with credentials; leaks methods/headers to disallowed origins
app.use((req, res, next) => {
  const origin = req.header("origin");
  if (isAllowedOrigin(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "*"); // "*" + credentials = broken
    res.header("Access-Control-Allow-Credentials", "true");
  }
  // These leak to ALL origins, even disallowed ones:
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
```

## Rules

1. **No-origin requests** (mobile apps, curl): omit CORS headers entirely — they don't need them
2. **Allowed origins**: reflect the specific `origin` value, set credentials + methods + headers
3. **Disallowed origins**: send no CORS headers at all — don't leak allowed methods/headers
4. **`isAllowedOrigin`** should use exact match or anchored regex patterns, not `.includes()`

## Related Files

- `server/index.ts` — CORS middleware
