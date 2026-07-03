---
title: Server-rendered GET landing for token verification when there's no universal-link infra
track: knowledge
category: design-patterns
module: server
tags: [email-verification, deep-linking, universal-links, auth, deployment, mobile]
applies_to: [server/routes/auth.ts, server/lib/verify-email-page.ts]
created: '2026-06-22'
---

# Server-rendered GET landing for token verification when there's no universal-link infra

## When this applies

You email a user a confirmation link (verify-email, magic-link, password reset,
unsubscribe) and need the tap to **complete an action and show a result** — but
the link is opened from arbitrary mail clients on arbitrary devices, and you do
**not** have the infra to deep-link reliably into the mobile app:

- no `associatedDomains` entitlement on the iOS app (and adding one needs a
  native rebuild),
- no hosted Apple App Site Association (`/.well-known/apple-app-site-association`)
  or Android `assetlinks.json`,
- no deployed web frontend at the link's domain.

In that situation a `https://yourdomain/...` universal link **dead-ends in a
browser** on a domain that serves nothing.

## Smell patterns

- An emailed link points at a domain/path with no deployed handler (a greenfield
  web domain, or an app-only deep-link path).
- The verification endpoint is a JSON `POST` API, but the email link is a `GET`
  URL — nothing bridges the tap to the POST.
- "It works if the app is installed AND on iOS AND AASA is hosted" — three
  conditions, each a silent failure mode.

## Why

A **server-rendered GET HTML page on the API you already have deployed** works in
**any** browser with zero of the above infra. Factor the verification logic into
one helper shared by the GET landing and the existing JSON POST so the two entry
points can't drift (`applyVerificationToken` in `server/routes/auth.ts`).

Performing the state change **on GET load** is safe **when** two properties hold
(verify both before doing it):

1. The token is a **stateless, signed** credential (e.g. an HS256 purpose/audience
   JWT) — so there's nothing to forge and CSRF is moot (an attacker can't mint a
   valid token).
2. The mutation is **idempotent** (`markEmailVerified` is a plain
   `UPDATE ... SET verified=true`) — so a mail-scanner pre-fetching the link
   merely completes the action early, which is the intended outcome anyway.

No confirm-button interstitial is needed under those properties. The page issues
**no session token** (confirming a link proves address ownership, not password
possession) and renders static HTML with **zero interpolated request input** (no
reflected-XSS surface from the `?token=` query string).

## Examples

```ts
// server/routes/auth.ts — shared helper, used by BOTH entry points
async function applyVerificationToken(token: string): Promise<boolean> {
  const payload = verifyVerificationToken(token); // signed-JWT verify
  if (!payload) return false;
  return Boolean(await storage.markEmailVerified(payload.sub)); // idempotent
}

// GET landing — renders HTML, not JSON. See the logging-invariant convention.
app.get("/verify-email", verifyEmailLimiter, async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  try {
    const ok = token.length > 0 && (await applyVerificationToken(token));
    res
      .status(ok ? 200 : 400)
      .type("html")
      .send(renderVerifyEmailPage(ok ? "success" : "invalid"));
  } catch {
    res.status(500).type("html").send(renderVerifyEmailPage("error"));
  }
});
```

The link is built as `${EMAIL_VERIFY_BASE_URL}/verify-email?token=…`, with
`EMAIL_VERIFY_BASE_URL` set to the **API host** (`https://api.ocrecipes.com`) in
prod — not the (undeployed) web/app domain. This is a **deployment prerequisite**:
if that env var is unset, the link falls back to the code default and dead-ends.

## Exceptions

- If you DO have universal links wired (entitlement + hosted AASA/assetlinks +
  the app handles the path), deep-linking into the app is a nicer UX and this
  pattern is unnecessary.
- The GET-verifies-on-load shortcut is **only** safe with the stateless-token +
  idempotent-mutation properties above. A single-use/stateful token, or a
  destructive/non-idempotent action, needs a POST behind a user gesture.
- The landing issues no session — the user still has to log in afterward. Give
  them an obvious path back to login (don't drop them on a dead-end screen).

## Related Files

- `server/lib/verify-email-page.ts` — the self-contained HTML renderer (inline
  CSS, no external assets)
- `server/routes/auth.ts` — `applyVerificationToken` + the `GET /verify-email`
  route + the `POST /api/auth/verify-email` API
- `client/navigation/linking.ts` — the app's deep-link config (the path exists
  but can't be reached by an emailed universal link without AASA)

## See Also

- [A token/secret-bearing URL route must be excluded from request-URL logging](../conventions/token-bearing-url-route-must-avoid-request-url-logging-2026-06-22.md) — the security invariant this landing depends on
- [Error-coercion logging helper flattens non-Error SDK objects](../code-quality/non-error-sdk-object-flattened-by-error-coercion-helper-2026-06-22.md) — surfaced debugging the send path that delivers this link
