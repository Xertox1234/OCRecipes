---
title: "supertest(app) on macOS can reach another process's server under load — a request never reaches your middleware, so hit-count tests flake"
track: bug
category: runtime-errors
module: server
severity: medium
tags: [testing, supertest, vitest, flaky, rate-limit, macos]
symptoms: ["expected 200 to be 429 on the (max+1)th request, passes alone", "stray 401/403/400 responses mid-loop with foreign headers (x-powered-by Dart with package:shelf)", "body 'WebSockets request was expected'", "fails only under parallel CPU load, never on Linux CI", "vitest retry then fails the other way (429 where 200 expected)"]
applies_to: ['server/routes/**/__tests__/**/*.ts']
created: 2026-10-20
---

# supertest(app) on macOS can reach another process's server under load

## Problem

`server/routes/__tests__/profile-hub-rate-limit.test.ts` sent 60 requests then expected the 61st to be 429. Under parallel load it got 200. Retries then failed the opposite way because the module-level limiter kept its counts.

## Root Cause

Looping the file 12-80x in parallel with `--retry=0` and logging every response showed 1-3 of the 61 requests answered by a different server (a Dart `shelf` 403, a foreign Express 401, a 400 "WebSockets request was expected"). Those never reached the limiter, so it counted 60 or fewer hits. Inferred mechanism: `request(app)` opens a fresh wildcard listener on an ephemeral port per request, and macOS lets another process bind `127.0.0.1` on the same port beside it; the client connects to 127.0.0.1 and lands on that process. Not proven at socket level. Ruled out: limiter key, MemoryStore window expiry, cross-file module sharing.

## Solution

Any test that depends on a request COUNT (rate limits, quotas) should bind one server to `127.0.0.1` and reuse it, assert every request in the loop was served by the app (status plus an app-only header such as `ratelimit-limit`), and build a fresh module graph per attempt when the limiter is module-level:

```ts
vi.resetModules();
const hub = await import("../profile-hub"); // fresh limiter store
const server = await new Promise<Server>((r) => {
  const s = app.listen(0, "127.0.0.1", () => r(s));
});
const res = await request(server).get(path); // not request(app)
```

## Related Files

- `server/routes/__tests__/profile-hub-rate-limit.test.ts`
