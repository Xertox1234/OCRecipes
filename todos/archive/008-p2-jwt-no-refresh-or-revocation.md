---
title: "JWT 30-day tokens with no refresh/revocation"
status: backlog
priority: high
created: 2026-02-24
updated: 2026-02-24
assignee:
labels: [security, code-review, auth]
---

# JWT Tokens: No Refresh or Revocation Mechanism

## Summary

JWTs expire after 30 days with no refresh token pattern and no way to revoke tokens. The logout endpoint is a no-op that returns `{ success: true }` without invalidating anything.

## Background

If a token is compromised, it remains valid for up to 30 days. Users who change passwords or "log out" cannot invalidate old tokens. Found in `server/middleware/auth.ts` line 58 and `server/routes/auth.ts` lines 105-108.

## Acceptance Criteria

- [ ] Implement refresh token pattern OR tokenVersion on user record
- [ ] Logout invalidates the token
- [ ] Password change invalidates all existing tokens
- [ ] Access token expiry reduced (e.g., 15 min with refresh tokens, or 7 days with version check)

## Updates

### 2026-02-24
- Found by security-sentinel agent
