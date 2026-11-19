---
title: "Vertex client uses the deprecated GoogleAuth `credentials` option"
status: done
priority: low
created: 2026-11-18
updated: 2026-11-19
assignee:
labels: [deferred, dependencies, ai]
github_issue:
---

# Vertex client uses the deprecated GoogleAuth `credentials` option

## Summary

`server/lib/vertex-client.ts` builds its service-account login with
`new GoogleAuth({ credentials: { client_email, private_key }, scopes })`. Since
`google-auth-library` 11.3.2 that prints a deprecation warning. It still works. Move to the
form the library recommends before a later major removes the option.

## Background

Found on 2026-11-18 while upgrading `google-auth-library` 10.9.1 → 11.3.4.

- On 11.3.4 the constructor prints once per call: "The `credentials` option is deprecated.
  Please use the `auth` object constructor instead. For more details, see
  https://cloud.google.com/docs/authentication/external/externally-sourced-credentials."
  10.9.1 prints nothing.
- The client is still built: an offline run with a throwaway key gave a `JWT` client with the
  right email and scope on both versions.
- It was not changed in the upgrade PR because the replacement cannot be checked without a
  real token request, which needs the production Vertex service-account key.

## Acceptance Criteria

- [x] `vertex-client.ts` builds its login without the deprecated option (for example a `JWT`
      client with `email`, `key` and `scopes`), and the warning no longer prints.
- [x] `server/lib/__tests__/vertex-client.test.ts` covers the new construction.
- [x] A real Vertex call succeeds after the change (owner check, or a deploy plus a vision
      request), since the unit test mocks the library.

## Scope

- `server/lib/vertex-client.ts`
- `server/lib/__tests__/vertex-client.test.ts`

## Updates

### 2026-11-18

- Code change: `new GoogleAuth({ authClient: new JWT({ email, key, scopes }) })`. GoogleAuth stays, so `getAccessToken()` still returns a string and the apiKey setter is unchanged.
- Offline probe against the real google-auth-library 11.3.4 with a throwaway RSA key: the old form prints the deprecation (control), the new form prints nothing; both build a `JWT` client with the same email and the cloud-platform scope; `GoogleAuth.getAccessToken()` returns the JWT client's token string.
- Left open for the third criterion only: a real Vertex call after the deploy (a vision request, or the owner's check). Close this todo when that succeeds.

### 2026-11-19

- Live check done from the laptop, owner's OK given first: one request through `createVertexClient` (main at 76ab07e02, google-auth-library 11.3.4, the Vertex service account in the local `.env`) to `google/gemini-3.8-flash`. Vertex answered in 2.5 s with usage of 7 prompt tokens and 20 in total, so the login token was issued and accepted. No deprecation warning printed (0 warnings captured).
- The reply text was empty: the 16-token limit was used up by the model's reasoning tokens (`finish_reason: length`). That is a limit of the probe, not of the login.
- Not checked: a vision request through the deployed server. The login code is the same there; the key on Railway was not read.
