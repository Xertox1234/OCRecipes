---
title: Auth endpoint response structure
track: knowledge
category: conventions
module: server
tags: [api, auth, response-shape, jwt]
applies_to: [server/routes/auth.ts]
created: '2026-05-13'
---

# Auth endpoint response structure

## Rule

Authentication endpoints (register, login, refresh, getMe) return user data plus token in a fixed shape:

```typescript
interface AuthResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    dailyCalorieGoal?: number;
    onboardingCompleted?: boolean;
  };
  token: string;
}
```

## Why

The client `AuthContext` and TanStack Query hooks expect a stable shape across every auth path. Drift between register/login/refresh handlers causes silent bugs where `displayName` is `null` on one path and `undefined` on another.

## Examples

Use `serializeUser()` (file-local helper in `server/routes/auth.ts`) instead of constructing this object inline in every handler. See the response serializer pattern for the helper itself.

## Related Files

- `server/routes/auth.ts` — `serializeUser()`, register/login/refresh/me handlers

## See Also

- [Response serializer functions](../design-patterns/response-serializer-functions-2026-05-13.md)
- [API error response structure](api-error-response-structure-2026-05-13.md)
