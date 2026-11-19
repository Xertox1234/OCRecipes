---
title: "A login-token fetch that times out is an outage (transport), not a bad key (config) — and gaxios has no timeout by default"
track: bug
category: logic-errors
tags: [api, architecture, ai-prompting]
module: server
applies_to: ["server/lib/vertex-client.ts", "server/lib/ai-failure.ts", "server/lib/ai-client.ts"]
symptoms: ["An AI call hangs with no timeout when oauth2.googleapis.com stalls", "A Google auth outage is reported as 'Vertex login failed — check GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL / _KEY'", "The Vertex circuit breaker never opens during an auth-endpoint outage"]
created: '2026-11-19'
severity: medium
---

# A login-token fetch that times out is an outage (transport), not a bad key (config)

## Problem

The Vertex client's OpenAI-SDK `apiKey` setter calls
`GoogleAuth.getAccessToken()` before every request, ahead of the SDK's own
per-call deadline. gaxios (google-auth-library 11.3.4 → gaxios 8.3.3) has no
timeout by default and retries the token POST 3 times (2 with no response). And
every token failure was wrapped in `VertexAuthError`, which `classifyAiFailure`
maps to `"config"` — no breaker count, a "check your key" report.

## Symptoms

See frontmatter.

## Root Cause

Two separate gaps: no bound on the token request, and one error class for
"Google said no" and "Google did not answer".

## Solution

Reliability audit 2026-11-19, M-rel-2:

- `new JWT({ …, transporterOptions: { timeout: 5_000, retryConfig: { retry: 1, noResponseRetries: 1 } } })`
  — cap BOTH retry counters; a timeout is governed by `noResponseRetries`.
- In the `apiKey` catch: a `gaxios.GaxiosError` with no response or a
  408/429/5xx rethrows as a plain `Error` (the SDK's `_callApiKey` wraps it in
  a generic `OpenAIError` → transport → breaker); everything else (400
  `invalid_grant`, 401, a key that fails at signing) stays `VertexAuthError`.
- Import `gaxios` via `google-auth-library`'s re-export so `instanceof` sees the
  class the transporter throws.

## Prevention

Mocking `google-auth-library` wholesale proves only that an option was passed.
`server/lib/__tests__/vertex-client-token.test.ts` uses the real library, a
generated RSA key and an injected `fetchImplementation` (gaxios uses its own
node-fetch in Node, so `vi.stubGlobal("fetch")` does NOT intercept — the first
attempt sent a real POST to Google). Controls: 400 and a bad PEM stay config.

## Related Files

- `server/lib/vertex-client.ts`
- `server/lib/ai-failure.ts` — `classifyAiFailure`, `VertexAuthError`

