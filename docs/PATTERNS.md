# Development Patterns

This document captures established patterns for the NutriScan codebase. Follow these patterns for consistency across features.

## Table of Contents

- [TypeScript Patterns](#typescript-patterns)
- [API Patterns](#api-patterns)
- [Client State Patterns](#client-state-patterns)
- [Performance Patterns](#performance-patterns)
- [Documentation Patterns](#documentation-patterns)

---

## TypeScript Patterns

### Shared Types Location

Place types used by both client and server in `shared/types/`:

```
shared/
  types/
    auth.ts      # Authentication types
    user.ts      # User-related types
    api.ts       # API request/response types
```

### Type Guards for Runtime Validation

Use type guards when validating data from external sources (API responses, JWT payloads, storage):

```typescript
// Define the expected shape
export interface AccessTokenPayload {
  sub: string;
}

// Create a type guard
export function isAccessTokenPayload(
  payload: unknown
): payload is AccessTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as AccessTokenPayload).sub === 'string'
  );
}

// Usage
const payload = jwt.verify(token, secret);
if (!isAccessTokenPayload(payload)) {
  throw new Error('Invalid payload');
}
// payload is now typed as AccessTokenPayload
```

### Extend Express Types Properly

When adding properties to Express Request:

```typescript
// In the file where you need it (not a global .d.ts)
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}
```

---

## API Patterns

### Error Response Structure

All API errors should follow this structure:

```typescript
interface ApiError {
  error: string;              // Human-readable message
  code?: string;              // Machine-readable code for client logic
  details?: Record<string, string>;  // Field-specific errors (validation)
}
```

Example error codes:
- `TOKEN_EXPIRED` - JWT token has expired
- `TOKEN_INVALID` - JWT token is malformed or invalid
- `NO_TOKEN` - No authentication token provided
- `VALIDATION_ERROR` - Request body validation failed
- `NOT_FOUND` - Resource not found
- `CONFLICT` - Resource already exists (e.g., duplicate username)

### Auth Response Structure

Authentication endpoints return user data plus token:

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

### Fail-Fast Environment Validation

Validate required environment variables at module load time, not at request time:

```typescript
// Good: Fails immediately on server start
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export function requireAuth(req, res, next) {
  // JWT_SECRET is guaranteed to exist here
  jwt.verify(token, JWT_SECRET);
}
```

```typescript
// Bad: Fails on first request, harder to debug
export function requireAuth(req, res, next) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
}
```

---

## Client State Patterns

### In-Memory Caching for Frequent Reads

When a value is read frequently but changes rarely, cache in memory with lazy initialization:

```typescript
let cachedValue: string | null = null;
let cacheInitialized = false;

export const storage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      try {
        cachedValue = await AsyncStorage.getItem(KEY);
      } catch (error) {
        console.error('Storage read failed:', error);
        cachedValue = null;
      }
      cacheInitialized = true;
    }
    return cachedValue;
  },

  async set(value: string): Promise<void> {
    cachedValue = value;
    cacheInitialized = true;
    await AsyncStorage.setItem(KEY, value);
  },

  async clear(): Promise<void> {
    cachedValue = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(KEY);
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedValue = null;
  },
};
```

**When to use:** Token storage, user preferences, feature flags.

**When NOT to use:** Data that changes frequently or needs real-time accuracy.

### Authorization Header Pattern

Include auth token via Authorization header, not cookies:

```typescript
const token = await tokenStorage.get();

const headers: HeadersInit = {};
if (data) {
  headers['Content-Type'] = 'application/json';
}
if (token) {
  headers['Authorization'] = `Bearer ${token}`;
}

const response = await fetch(url, { method, headers, body });
```

**Why:** React Native/Expo Go does not reliably persist HTTP cookies. Authorization headers work consistently across all platforms.

### Handle 401 Globally

Clear auth state on any 401 response:

```typescript
if (response.status === 401) {
  await tokenStorage.clear();
  // Trigger re-authentication flow
}
```

---

## Performance Patterns

### Avoid Storage Reads in Hot Paths

AsyncStorage operations take 2-10ms. For values read on every API request, use in-memory caching (see above).

### Batch Related Storage Operations

When storing multiple related values, use multiSet/multiRemove:

```typescript
// Good: Single storage operation
await AsyncStorage.multiSet([
  [USER_KEY, JSON.stringify(user)],
  [TOKEN_KEY, token],
]);

// Bad: Multiple operations
await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
await AsyncStorage.setItem(TOKEN_KEY, token);
```

---

## Documentation Patterns

### Todo Structure

All todos in `todos/` follow the template in `todos/TEMPLATE.md`:

```yaml
---
title: "Brief descriptive title"
status: backlog | planned | in-progress | blocked | review | done
priority: critical | high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
---
```

### Design Decisions Table

Document key architectural choices with rationale:

```markdown
## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token type | Single access token | No refresh token complexity |
| Token expiry | 30 days | Balances security with UX |
```

### Files to Modify Table

List all files affected by a change:

```markdown
## Files to Modify

| File | Action |
|------|--------|
| `shared/types/auth.ts` | Create - type definitions |
| `server/routes.ts` | Modify - use new middleware |
```

### Implementation Patterns in Todos

Include copy-paste ready code examples in todos for complex changes. This ensures:
- Consistent implementation
- Faster development
- Built-in code review

---

## Adding New Patterns

When you establish a new pattern:

1. Use it in your implementation
2. Document it here with:
   - What the pattern is
   - When to use it
   - When NOT to use it
   - Code example
3. Reference this doc in your todo/PR
