---
title: "Generic error messages for 5xx responses"
track: knowledge
category: conventions
tags: [security, error-handling, information-disclosure, express]
module: server
applies_to: ["server/index.ts"]
created: 2026-05-13
---

# Generic error messages for 5xx responses

## Rule

The global error handler returns the actual error message for 4xx (client errors) but a generic `"Internal Server Error"` for 5xx. This prevents leaking stack traces, SQL errors, or internal service details to clients.

## Examples

```typescript
// Global error handler
const status = error.status || error.statusCode || 500;

// Only expose error messages for client errors (4xx)
const message =
  status < 500 ? error.message || "Bad Request" : "Internal Server Error";

return res.status(status).json({ error: message });
```

## Why

A 500 error message like `"relation \"users\" does not exist"` or `"ECONNREFUSED 127.0.0.1:5432"` reveals database technology and network topology. Always log the real error server-side (`console.error`) and return a generic message to the client.

## Related Files

- `server/index.ts` — `setupErrorHandler()`

## See Also

- [Sensitive path logging exclusion](sensitive-path-logging-exclusion-2026-05-13.md)
- [Multer error handler pattern](../design-patterns/multer-error-handler-pattern-2026-05-13.md)
