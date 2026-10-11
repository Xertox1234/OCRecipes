---
title: A route that uses its own auth scheme must be pinned by the static wiring scan in both directions — allow-listing it as "public" lets the scheme be removed silently
track: knowledge
category: conventions
tags: [security, api, auth, testing, middleware]
module: server
applies_to: ["server/routes/__tests__/auth-route-wiring.test.ts", "server/routes/auth-upgrade.ts", "server/middleware/upgrade-pass.ts"]
created: 2026-10-10
---

# A route that uses its own auth scheme must be pinned by the static wiring scan in both directions — allow-listing it as "public" lets the scheme be removed silently

## Rule

`server/routes/__tests__/auth-route-wiring.test.ts` scans every `app.METHOD("/api…")` registration and fails on any route without `requireAuth` that isn't in `PUBLIC_ROUTES`. When a route is guarded by a **different** middleware (e.g. `requireUpgradePass` for a short password's sign-in pass), adding it to `PUBLIC_ROUTES` is not enough. Record that middleware in the scan and assert both directions:

1. Every route in the family carries it, with a non-vacuous denominator (the exact list of routes the scan found).
2. No route outside the family carries it, so the restricted credential can never unlock anything else.

```ts
hasUpgradePass: /\brequireUpgradePass\b/.test(windowText),
…
expect(upgrade.map((r) => r.key).sort()).toEqual([ /* the 3 routes */ ]);
expect(upgrade.filter((r) => !r.hasUpgradePass).map((r) => r.key)).toEqual([]);
expect(routes.filter((r) => r.hasUpgradePass && !isUpgrade(r)).map((r) => r.key)).toEqual([]);
```

## Why

- `PUBLIC_ROUTES` means "runs with no auth at all". If an alternately-guarded route is listed there, deleting its guard leaves the test green, and the route becomes truly public. That is the regression the scan exists to catch, and mocked-auth route tests can't see it either.
- The second direction matters for restricted credentials. A pass meant only for "enrol two-step / set a longer password" must not appear in front of any other route. Otherwise a short password, the very thing the gate exists to stop, gets a session-equivalent.

## Examples

- Password policy part 2: `/api/auth/upgrade/{totp/setup,totp/confirm,password}` sit behind `requireUpgradePass`. They are in `PUBLIC_ROUTES` with that reason, and a dedicated test pins the three keys plus both directions.

## Exceptions

- Routes that genuinely carry their credential in the body (a single-use challenge or ticket, as `/api/auth/mfa/verify` does) have no middleware to pin. The allowlist reason must name the credential.

## Related Files

- `server/routes/__tests__/auth-route-wiring.test.ts`
- `server/routes/auth-upgrade.ts`
- `server/middleware/upgrade-pass.ts`

## See Also

- `docs/solutions/conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md`
- `docs/solutions/conventions/requireauth-middleware-over-manual-checks-2026-05-13.md`
