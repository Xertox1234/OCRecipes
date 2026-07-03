---
title: Credential-keyed failed-attempt throttle (per-account login lockout)
track: knowledge
category: design-patterns
module: server
tags: [security, rate-limiting, auth, brute-force, express-rate-limit]
applies_to: [server/routes/_rate-limiters.ts, server/routes/auth.ts]
created: '2026-06-10'
---

# Credential-keyed failed-attempt throttle (per-account login lockout)

## When this applies

An IP-keyed login limiter cannot stop a distributed attacker rotating source IPs against one account. To close that gap, add a **second** `express-rate-limit` layer keyed by the normalized credential (username), chained **after** the IP limiter. The layers compose — never replace one with the other.

## Rule

- Use `skipSuccessfulRequests: true` so only failed attempts (HTTP status ≥ 400) count toward the lockout window. A successful response decrements the counter, meaning legitimate logins never accumulate toward lockout.
- Define the `keyGenerator` before Zod validation. Coerce `req.body.username` to a String, trim, lowercase, and cap at 100 characters. A pure exported helper (`normalizeUsernameKey`) in `server/routes/_rate-limiters.ts` handles this. `String()` never throws on JSON-derived values (e.g., an object becomes `'[object Object]'`, a harmless shared bucket unreachable by any real account).
- Fall back to the project’s `ipKeyGenerator` when no usable username is present — never use a single shared global bucket.
- Prefix credential-based keys with `login-account:` to avoid collision with IP-fallback keys in the same store.
- The throttled 429 response must be byte-identical in status, body, and headers to the generic IP-keyed limiter response (same message string, code `RATE_LIMITED`, and `standardHeaders`). The limiter never consults storage, so timing remains flat, preventing account-existence oracles.
- Lockout-DoS mitigation: use a short window (15 minutes) and a threshold well above typical typo counts (e.g., 10 failed attempts). Never implement a hard lockout — the threshold resets after the window.
- This is the documented `createRateLimiter` factory exception — body-derived `keyGenerator` limiters are defined inline in `server/routes/_rate-limiters.ts`, not through the factory.
- Known accepted coupling: key normalization lowercases usernames, but account lookup is exact-match. Mixed-case distinct accounts share one throttle bucket, creating minor cross-account lockout coupling. This is not a brute-force bypass — the key set is a strict superset of the lookup match.
- Testing: use a dedicated test file with **no** `vi.mock('express-rate-limit')` to exercise the real middleware. Rotate client IPs via `app.set('trust proxy', 1)` and the `X-Forwarded-For` header to simulate a distributed attacker. The limiter’s `MemoryStore` persists for the file lifetime, so each test must use its own usernames and IP range. See `server/routes/__tests__/auth-account-throttle.test.ts`.

## Why

Brute force attacks that distribute requests across many IPs bypass IP-based rate limiting. By adding a credential-keyed throttle that counts only failed attempts, we lock out attackers targeting a single account without affecting legitimate users. The `skipSuccessfulRequests` option ensures that a successful login clears the count, preventing lockout from accumulated successes. The careful key normalization and fallback prevent bucket collisions and misbehavior.

## Examples

```typescript
// server/routes/_rate-limiters.ts

// Pure helper — runs at keyGenerator time, BEFORE Zod validation, so the
// value may be any JSON type. Returns null when no usable username exists.
export function normalizeUsernameKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase().slice(0, 100);
  return normalized.length > 0 ? normalized : null;
}

export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 failed attempts per window
  skipSuccessfulRequests: true, // only count failures (status >= 400)
  standardHeaders: true,
  legacyHeaders: false,
  // Byte-identical to loginLimiter's 429 body — no account-existence oracle.
  message: {
    error: "Too many login attempts, please try again later",
    code: "RATE_LIMITED",
  },
  keyGenerator: (req) => {
    const username = normalizeUsernameKey(
      (req.body as { username?: unknown } | undefined)?.username,
    );
    // Prefix prevents collisions with IP-fallback keys in the same store.
    return username ? `login-account:${username}` : ipKeyGenerator(req);
  },
});

// server/routes/auth.ts — IP limiter first, then the account-keyed layer
app.post("/api/auth/login", loginLimiter, loginAccountLimiter, handler);
```

## Exceptions

- Do **not** use credential-keyed throttling on any endpoint that does not support `skipSuccessfulRequests` — otherwise a single successful login would still count toward lockout.
- If account enumeration via response timing is acceptable and you have other mitigations, you may omit the response uniformity requirement.
- This pattern is **not** appropriate for registration endpoints where credentials are not yet validated; use IP-based throttling for registration.

## Related Files

- `server/routes/_rate-limiters.ts`
- `server/routes/auth.ts`

## See Also

- [Rate limiting on auth endpoints](rate-limiting-auth-endpoints-2026-05-13.md)
- [createRateLimiter factory](create-rate-limiter-factory-2026-05-13.md)
