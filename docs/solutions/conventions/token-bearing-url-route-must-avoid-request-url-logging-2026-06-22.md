---
title: A token/secret-bearing URL route must be excluded from request-URL logging
track: knowledge
category: conventions
module: server
tags: [security, logging, observability, tokens, auth, pino]
applies_to: [server/routes/**/*.ts, server/index.ts]
created: '2026-06-22'
---

# A token/secret-bearing URL route must be excluded from request-URL logging

## Rule

Any route that accepts a secret in the **URL query string** — a verification
token, password-reset token, magic-link, signed download URL — must be kept off
whatever code path writes the request **URL** to logs. Otherwise the live secret
is persisted in your access logs (and anywhere they're shipped) as a usable
credential.

In this codebase the request logger (`pino-http` in `server/index.ts`) has an
`autoLogging.ignore` predicate that **skips every URL not starting with `/api`**,
and its success/error message serializers interpolate `req.url` (which includes
the query string). So the rule here is concrete: **a token-in-query route must
live OUTSIDE the `/api` prefix.** `GET /verify-email?token=…` is mounted at the
top level precisely for this reason — pino never logs it, so the 24h token never
lands in access logs. Mounting it under `/api/...` would silently start writing
the token to logs.

## Smell patterns

- A new route reads `req.query.token` / `req.query.secret` / a signed param, and
  sits under a path prefix that the request logger records.
- A logging serializer interpolates `req.url` / `req.originalUrl` (not just the
  path) — that carries the query string.
- Moving a token-bearing route under `/api` "for consistency" — that's the exact
  refactor that breaks this invariant silently.

## Why

The token is a bearer credential for its TTL. Access logs are long-lived, often
shipped to third parties (log aggregators, error trackers), and readable by more
people than the DB. A token written there is a credential leak with a wide
blast radius and no alarm. Excluding the route from URL-logging closes it at the
source; pair it with a short token TTL and a single-purpose audience claim so a
leak elsewhere (browser history, Referer) is bounded.

## Examples

```ts
// server/routes/auth.ts — the route comment pins the invariant so a future
// refactor doesn't silently break it:
//
//   SECURITY INVARIANT — this route MUST stay OUTSIDE the `/api` prefix. The
//   token rides in the query string, and pino-http's `autoLogging.ignore`
//   (server/index.ts) skips every URL that doesn't start with `/api`, so the
//   live token never lands in access logs.
app.get("/verify-email", verifyEmailLimiter, async (req, res) => {
  /* … */
});
```

Complementary defenses already in place for the same route: `helmet` sets
`Referrer-Policy: no-referrer`, and the landing page renders **no external
subresources**, so the token can't leak via the `Referer` header either.

## Exceptions

- Prefer keeping the secret **out of the URL entirely** (POST body / header) when
  the client can do that. This rule is for the cases where an emailed/clickable
  link forces the secret into a GET URL.
- Browser history still retains the URL; accept that as a bounded risk (short TTL,
  single-purpose token) rather than trying to scrub it.

## Related Files

- `server/index.ts` — `pino-http` request logger; `autoLogging.ignore` (the
  `/api`-prefix gate) and the `req.url`-interpolating message serializers
- `server/routes/auth.ts` — `GET /verify-email`, mounted outside `/api` with the
  invariant pinned in a comment

## See Also

- [Server-rendered GET landing for token verification](../design-patterns/server-rendered-get-verification-landing-no-universal-link-2026-06-22.md) — the route this invariant protects
