---
title: "Move JWT types out of shared/types/auth.ts to server-only location"
status: backlog
priority: medium
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [architecture, audit-2026-03-27-full]
audit_id: M10
---

# Move JWT types out of shared/types/auth.ts to server-only location

## Summary

`shared/types/auth.ts:1` imports `JwtPayload` from `jsonwebtoken`, a server-only package. If any client file accidentally does a runtime import (dropping `type`), it would pull `jsonwebtoken` into the React Native bundle.

## Acceptance Criteria

- [ ] `AccessTokenPayload` interface and `isAccessTokenPayload` function moved to `server/lib/jwt-types.ts`
- [ ] `shared/types/auth.ts` retains only client-safe types (`User`, `AuthResponse`, etc.)
- [ ] No `jsonwebtoken` imports in `shared/`
- [ ] Existing tests pass, types pass

## Implementation Notes

- Update all server-side imports of `AccessTokenPayload` and `isAccessTokenPayload`
- Client currently only uses `User` and `AuthResponse` from this file

## Dependencies

- None

## Risks

- Many server files may import from `shared/types/auth.ts` — need to update all

## Updates

### 2026-03-27

- Created from full audit finding M10
