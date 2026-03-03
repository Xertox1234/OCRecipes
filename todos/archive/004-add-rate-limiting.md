---
title: "Add rate limiting to authentication endpoints"
status: complete
priority: high
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [security, api, code-review]
---

# Add Rate Limiting to Auth Endpoints

## Summary

The `/api/auth/login` and `/api/auth/register` endpoints have no rate limiting, enabling brute force attacks and credential stuffing.

## Background

Without rate limiting, attackers can perform unlimited password guessing attempts. While bcrypt provides some protection (slow hashing), it doesn't prevent account lockout attacks or credential stuffing.

**Affected endpoints:**
- `POST /api/auth/login` (server/routes.ts:53-89)
- `POST /api/auth/register` (server/routes.ts:14-51)

## Acceptance Criteria

- [ ] Add rate limiting to login endpoint (5 attempts per 15 minutes per IP)
- [ ] Add rate limiting to register endpoint (3 attempts per hour per IP)
- [ ] Return appropriate error message when rate limited
- [ ] Consider per-username rate limiting for login

## Implementation Notes

```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: "Too many login attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: { error: "Too many registration attempts" },
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {...});
app.post("/api/auth/register", registerLimiter, async (req, res) => {...});
```

## Dependencies

- Install `express-rate-limit` package

## Risks

- Could block legitimate users on shared IPs (consider this for production)

## Updates

### 2026-01-30
- Initial creation from code review
