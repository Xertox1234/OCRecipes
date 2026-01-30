---
title: "Migrate from Session-Based Auth to JWT for Expo Go Compatibility"
status: completed
priority: critical
created: 2026-01-29
updated: 2026-01-29
assignee:
labels: [auth, security, mobile, breaking-change]
---

# Migrate from Session-Based Auth to JWT for Expo Go Compatibility

## Summary

Replace the current `express-session` cookie-based authentication with JWT tokens to ensure compatibility with React Native/Expo Go, where HTTP cookies do not persist reliably.

## Background

An audit of the authentication system revealed that the current implementation is **not suitable for Expo Go mobile apps**:

1. **Cookie Persistence Failure**: React Native's `fetch` with `credentials: "include"` does not maintain a persistent cookie jar like web browsers
2. **httpOnly Cookies Inaccessible**: Cannot read/manage httpOnly cookies in React Native JavaScript
3. **False Positive Auth State**: User appears logged in (AsyncStorage) but API calls fail (no valid session cookie)
4. **Memory-Only Session Store**: Sessions lost on server restart, not production-ready

### Current Architecture (Problematic)

```
Client                          Server
  │                               │
  ├─ POST /login ────────────────>│
  │<──── Set-Cookie: connect.sid ─┤  (Cookie may not persist in RN)
  │                               │
  ├─ GET /api/data ──────────────>│
  │  (Cookie: connect.sid)        │  (Cookie often missing)
  │<──── 401 Unauthorized ────────┤
```

### Target Architecture (JWT)

```
Client                          Server
  │                               │
  ├─ POST /login ────────────────>│
  │<──── { user, token } ─────────┤  (Store token in AsyncStorage)
  │                               │
  ├─ GET /api/data ──────────────>│
  │  Authorization: Bearer <token>│  (Always sent from memory cache)
  │<──── { data: ... } ───────────┤
```

## Design Decisions

Based on expert review, we're using a **simplified approach**:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Token type | Single access token | No refresh token complexity |
| Token expiry | 30 days | Balances security with UX for a nutrition app |
| Token blacklist | None | Client-side logout sufficient; no DB overhead |
| Logout behavior | Client clears token | Stateless, simple |
| Backwards compatibility | None | No web clients exist |

## Acceptance Criteria

### Server Changes

- [ ] Add `jsonwebtoken` package with `@types/jsonwebtoken`
- [ ] Create shared types in `shared/types/auth.ts`
- [ ] Create `generateToken(userId): string` utility with 30-day expiry
- [ ] Create `requireAuth` middleware with proper TypeScript types
- [ ] Validate `JWT_SECRET` exists on server startup (fail fast)
- [ ] Update `/api/auth/register` to return `{ user, token }`
- [ ] Update `/api/auth/login` to return `{ user, token }`
- [ ] Update `/api/auth/logout` to just return success (stateless)
- [ ] Update all protected routes to use `requireAuth` middleware
- [ ] Remove `express-session` dependency

### Client Changes

- [ ] Create `tokenStorage` utility with in-memory cache
- [ ] Update `apiRequest()` to include `Authorization: Bearer` header
- [ ] Update `useAuth` hook to store/retrieve token
- [ ] On 401 response, clear token and set auth state to logged out
- [ ] Remove `credentials: "include"` from all fetch calls

### Testing

- [ ] Test login persists across app restart on iOS Expo Go
- [ ] Test login persists across app restart on Android Expo Go
- [ ] Test protected routes reject missing tokens
- [ ] Test protected routes reject invalid/malformed tokens
- [ ] Test logout clears token and redirects to login

## Implementation Patterns

> These patterns are documented in [`docs/PATTERNS.md`](../docs/PATTERNS.md) for reuse across the codebase.

### Shared Types

Create `shared/types/auth.ts`:

```typescript
import { JwtPayload } from 'jsonwebtoken';

// JWT payload structure
export interface AccessTokenPayload extends JwtPayload {
  sub: string;  // User ID
}

// Type guard for payload validation
export function isAccessTokenPayload(
  payload: string | JwtPayload
): payload is AccessTokenPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof payload.sub === 'string'
  );
}

// API response types
export interface AuthResponse {
  user: {
    id: string;
    username: string;
    displayName?: string;
    dailyCalorieGoal?: number;
    onboardingCompleted?: boolean;
  };
  token: string;
}

export interface ApiError {
  error: string;
  code?: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'NO_TOKEN';
}
```

### Server Middleware

Create `server/middleware/auth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isAccessTokenPayload } from '@shared/types/auth';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;

// Validate on module load - fail fast
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (!isAccessTokenPayload(payload)) {
      res.status(401).json({ error: 'Invalid token payload', code: 'TOKEN_INVALID' });
      return;
    }

    req.userId = payload.sub;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
      return;
    }
    res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}
```

### Client Token Storage (with Cache)

Create `client/lib/token-storage.ts`:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@nutriscan_token';

// In-memory cache to avoid AsyncStorage read on every request
let cachedToken: string | null = null;
let cacheInitialized = false;

export const tokenStorage = {
  async get(): Promise<string | null> {
    if (!cacheInitialized) {
      try {
        cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
      } catch (error) {
        console.error('Failed to read token from storage:', error);
        cachedToken = null;
      }
      cacheInitialized = true;
    }
    return cachedToken;
  },

  async set(token: string): Promise<void> {
    if (!token || typeof token !== 'string') {
      throw new Error('Token must be a non-empty string');
    }
    cachedToken = token;
    cacheInitialized = true;
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    cachedToken = null;
    cacheInitialized = true;
    await AsyncStorage.removeItem(TOKEN_KEY);
  },

  // For testing or forced refresh
  invalidateCache(): void {
    cacheInitialized = false;
    cachedToken = null;
  },
};
```

### Client API Request

Update `client/lib/query-client.ts`:

```typescript
import { tokenStorage } from './token-storage';

export async function apiRequest(
  method: string,
  route: string,
  data?: unknown
): Promise<Response> {
  const baseUrl = getApiUrl();
  const url = new URL(route, baseUrl);
  const token = await tokenStorage.get();

  const headers: HeadersInit = {};
  if (data) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    // NOTE: credentials: "include" removed - using Authorization header
  });

  await throwIfResNotOk(res);
  return res;
}
```

### Client Auth Hook Updates

Key changes to `client/hooks/useAuth.ts`:

```typescript
import { tokenStorage } from '@/lib/token-storage';

// In login:
const login = useCallback(async (username: string, password: string) => {
  const response = await apiRequest('POST', '/api/auth/login', {
    username,
    password,
  });
  const { user, token } = await response.json();
  await tokenStorage.set(token);
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  setState({ user, isLoading: false, isAuthenticated: true });
  return user;
}, []);

// In logout:
const logout = useCallback(async () => {
  await tokenStorage.clear();
  await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
  setState({ user: null, isLoading: false, isAuthenticated: false });
}, []);

// In checkAuth - handle 401:
const checkAuth = useCallback(async () => {
  const token = await tokenStorage.get();
  if (!token) {
    setState({ user: null, isLoading: false, isAuthenticated: false });
    return;
  }

  try {
    const response = await apiRequest('GET', '/api/auth/me');
    if (response.ok) {
      const user = await response.json();
      setState({ user, isLoading: false, isAuthenticated: true });
    } else {
      // Token invalid/expired
      await tokenStorage.clear();
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  } catch {
    // Network error - keep user logged in with cached data
    const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      setState({ user: JSON.parse(stored), isLoading: false, isAuthenticated: true });
    } else {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }
}, []);
```

## Environment Variables

Add to `.env`:

```
JWT_SECRET=<generate-256-bit-secret>
```

Generate with: `openssl rand -base64 32`

## Files to Modify

| File | Action |
|------|--------|
| `shared/types/auth.ts` | Create - shared type definitions |
| `server/middleware/auth.ts` | Create - JWT middleware |
| `server/routes.ts` | Modify - use new middleware, return tokens |
| `server/index.ts` | Modify - remove session setup |
| `client/lib/token-storage.ts` | Create - token management |
| `client/lib/query-client.ts` | Modify - add Authorization header |
| `client/hooks/useAuth.ts` | Modify - use token storage |
| `package.json` | Modify - add jsonwebtoken, remove express-session |

## Dependencies

**Add:**
- `jsonwebtoken` - JWT creation and verification
- `@types/jsonwebtoken` - TypeScript definitions

**Remove:**
- `express-session` - No longer needed
- `@types/express-session` - No longer needed

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Token theft on compromised device | Low | Medium | 30-day expiry limits exposure window |
| User locked out if token corrupted | Low | Low | Clear storage and re-login |
| Breaking existing dev sessions | High | Low | Expected - just re-login |

## Updates

### 2026-01-29
- Initial creation after auth system audit
- Expert review by TypeScript, Performance, and Simplicity reviewers
- Simplified from 27 to 12 acceptance criteria
- Removed refresh tokens, token blacklist, backwards compatibility
- Added in-memory token cache pattern for performance
- Added proper TypeScript type definitions
