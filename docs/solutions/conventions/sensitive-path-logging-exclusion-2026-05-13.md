---
title: "Sensitive path logging exclusion"
track: knowledge
category: conventions
tags: [security, logging, pii, hipaa, gdpr]
module: server
applies_to: ["server/index.ts"]
created: 2026-05-13
---

# Sensitive path logging exclusion

## Rule

Exclude response bodies for routes that return tokens, passwords, or medical data from request logging. Match by path prefix to catch sub-routes.

## Examples

```typescript
const SENSITIVE_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/account",
  "/api/medication",
];

function isSensitivePath(reqPath: string): boolean {
  return SENSITIVE_PATHS.some(
    (p) => reqPath === p || reqPath.startsWith(p + "/"),
  );
}

// In request logger:
if (capturedJsonResponse && !isSensitivePath(reqPath)) {
  logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
}
```

## Why

Request logs often end up in log aggregators, monitoring dashboards, and error tracking tools. Logging JWT tokens, hashed passwords, or medical data (medication names, dosages) in response bodies violates security best practices and may violate privacy regulations (HIPAA, GDPR).

## Related Files

- `server/index.ts` — `setupRequestLogging()` with `isSensitivePath()` check
