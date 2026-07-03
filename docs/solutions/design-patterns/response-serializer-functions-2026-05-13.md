---
title: Response serializer functions for shared object shapes
track: knowledge
category: design-patterns
module: server
tags: [api, serialization, dry, helper, response-shape]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# Response serializer functions for shared object shapes

## When this applies

When multiple route handlers in the same file return the same object shape (auth endpoints returning user objects, admin endpoints returning sanitized records), extract a `serializeX()` function to avoid repeating the field list and normalization logic.

## Why

Normalizations (e.g., `|| "free"` fallback for `subscriptionTier`) drift across handlers. When the response shape changes, every handler must be updated by hand. A single serializer makes both the field list and the fallbacks a one-place change.

## Examples

```typescript
// Good: single serializer used across register/login/refresh/me handlers
function serializeUser(user: {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
  };
}

// Usage in route handler
res.status(201).json({ user: serializeUser(user), token });
res.json({ user: serializeUser(user), token });
```

```typescript
// Bad: field list + normalization logic duplicated across 4 handlers
res.json({
  user: {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free", // normalization silently diverges
  },
  token,
});
```

## When to use

2+ handlers in the same route file that return an object with the same shape. The serializer is file-local (not exported) unless the shape is needed across multiple route files.

## Exceptions

One-off responses unique to a single handler.

## Related Files

- `server/routes/auth.ts` — `serializeUser()` used by register, login, refresh, and getMe handlers

## See Also

- [Auth endpoint response structure](../conventions/api-auth-response-structure-2026-05-13.md)
- [PII stripping in API response serialization](pii-stripping-api-response-serialization-2026-05-13.md)
