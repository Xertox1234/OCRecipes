---
title: "Fix missing Authorization header in useAuth checkAuth"
status: complete
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [bug, auth, code-review]
---

# Fix Missing Authorization Header in checkAuth

## Summary

The `checkAuth` function in useAuth.ts makes a fetch to `/api/auth/me` without the Authorization header, causing it to always fail for JWT-based authentication.

## Background

**Location:** `client/hooks/useAuth.ts:40-42`

```typescript
const response = await fetch(`${getApiUrl()}/api/auth/me`, {
  credentials: "include",  // This is for cookies, not JWT
});
```

The app uses JWT authentication, not session cookies. The `credentials: "include"` only sends cookies, but the server expects a Bearer token in the Authorization header.

The code falls back to local storage (line 60-66) which may contain stale user data.

## Acceptance Criteria

- [ ] Add Authorization header with Bearer token to the fetch call
- [ ] Remove `credentials: "include"` as it's not needed for JWT
- [ ] Handle token-expired response appropriately
- [ ] Test that user data refreshes correctly on app restart

## Implementation Notes

```typescript
const checkAuth = useCallback(async () => {
  try {
    const token = await tokenStorage.get();
    if (!token) {
      setState({ user: null, isLoading: false, isAuthenticated: false });
      return;
    }

    const response = await fetch(`${getApiUrl()}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const freshUser = await response.json();
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(freshUser));
      setState({ user: freshUser, isLoading: false, isAuthenticated: true });
    } else if (response.status === 401) {
      // Token expired or invalid
      await tokenStorage.clear();
      await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  } catch {
    // Network error - use cached data
    const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
    if (stored) {
      setState({ user: JSON.parse(stored), isLoading: false, isAuthenticated: true });
    } else {
      setState({ user: null, isLoading: false, isAuthenticated: false });
    }
  }
}, []);
```

## Dependencies

- None

## Risks

- None - this is a bug fix

## Updates

### 2026-01-30
- Initial creation from code review
