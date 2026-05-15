---
title: "SSRF protection for server-side URL fetching"
track: knowledge
category: conventions
tags: [security, ssrf, fetch, dns-rebinding, url-validation]
module: server
applies_to: ["server/services/**/*.ts", "server/routes/**/*.ts"]
created: 2026-05-13
---

# SSRF protection for server-side URL fetching

## Rule

When the server fetches a user-provided URL (e.g., recipe import, link previews), use the hardened `safeFetch` implementation in `server/services/recipe-import.ts`. Never call `fetch()` directly on user-supplied URLs.

## When this applies

Any endpoint where the server fetches a URL supplied by the user (import flows, link previews, webhook callbacks).

## What `safeFetch` provides

- **URL blocklist** (`isBlockedUrl`): Blocks localhost, private IPs (IPv4 and IPv6), link-local, hex-encoded IPs, and non-HTTP(S) protocols.
- **DNS rebinding prevention** (`resolveAndValidateHost`): Resolves hostnames via `dns.promises.lookup` and validates the resolved IP against the same blocklist, preventing attackers from using DNS that initially resolves to a public IP then rebinds to a private one.
- **Redirect validation**: Follows redirects manually (`redirect: "manual"`) up to `MAX_REDIRECTS`, re-validating each redirect target against the blocklist and DNS check.
- **Response size limits**: Enforces `MAX_RESPONSE_BYTES` via both `Content-Length` header check and streaming byte count.
- **Timeout**: Uses `AbortSignal.timeout()` to cap total fetch duration.

## Examples

```typescript
// For URL validation without fetching:
import { isBlockedUrl } from "./services/recipe-import";
if (isBlockedUrl(url)) {
  return { success: false, error: "FETCH_FAILED" };
}

// For full protected fetch, use importRecipeFromUrl which calls safeFetch internally.
// See server/services/recipe-import.ts for the full implementation.
```

## Why

Without validation, attackers can use the server as a proxy to reach internal services (localhost, AWS metadata at 169.254.169.254, private network hosts). Zod's `z.string().url()` only validates URL syntax, not the target.

## Related Files

- `server/services/recipe-import.ts` — `safeFetch`, `isBlockedUrl`, `resolveAndValidateHost`
