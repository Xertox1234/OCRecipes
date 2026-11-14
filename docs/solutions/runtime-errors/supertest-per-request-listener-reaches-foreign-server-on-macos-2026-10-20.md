---
title: "supertest(app) on macOS can reach another process's server under load — a request never reaches your middleware, so hit-count tests flake"
track: bug
category: runtime-errors
module: server
severity: medium
tags: [testing, supertest, vitest, flaky, rate-limit, macos]
symptoms: ["expected 200 to be 429 on the (max+1)th request, passes alone", "stray 401/403/400 responses mid-loop with foreign headers (x-powered-by Dart with package:shelf)", "body 'WebSockets request was expected'", "fails only under parallel CPU load, never on Linux CI", "vitest retry then fails the other way (429 where 200 expected)"]
applies_to: ['server/**/__tests__/**/*.ts', 'test/setup.ts']
created: 2026-10-20
---

# supertest(app) on macOS can reach another process's server under load

## Problem

`server/routes/__tests__/profile-hub-rate-limit.test.ts` sent 60 requests then expected the 61st to be 429. Under parallel load it got 200. Retries then failed the opposite way because the module-level limiter kept its counts.

## Root Cause

Looping the file 12-80x in parallel with `--retry=0` and logging every response showed 1-3 of the 61 requests answered by a different server (a Dart `shelf` 403, a foreign Express 401, a 400 "WebSockets request was expected"). Those never reached the limiter, so it counted 60 or fewer hits. Ruled out: limiter key, MemoryStore window expiry, cross-file module sharing.

supertest's `request(app)` calls `app.listen(0)` (wildcard `::`) and then connects to `127.0.0.1:<port>` (`node_modules/supertest/lib/test.js`, `serverAddress`). Measured with two Node processes, 2026-10-20, Node 24:

| Order                                                  | macOS 26                                                          | Linux (Docker, kernel 7.0)  |
| ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------- |
| other process holds `127.0.0.1:P`, then we bind `::` P | bind OK; client to `127.0.0.1:P` reaches the OTHER process        | `EADDRINUSE`                |
| we hold `::` P, then other process binds `127.0.0.1:P` | bind OK; client to `127.0.0.1:P` reaches the OTHER process        | `EADDRINUSE`                |
| we bind `127.0.0.1` exactly on a held port             | `EADDRINUSE`                                                      | `EADDRINUSE`                |

So the collision is macOS-only: CI (Ubuntu) cannot hit it, and a listener bound to `127.0.0.1` itself never shares its port.

## Solution

**supertest ≥ 7.3 fixes this upstream:** its `holdServer` calls `server.listen(0, '127.0.0.1')`. Nothing to patch. `test/supertest-loopback.test.ts` is the canary: it asserts `req.socket.localAddress === "127.0.0.1"` (a wildcard listener reports `::ffff:127.0.0.1`), so a supertest that drops the bind fails loudly instead of silently reopening the flake.

History, and why an internals patch is a trap: from 2026-10-20 to 2026-11-09 `test/setup.ts` monkey-patched `Test.prototype.serverAddress`/`end` (written against 7.2.2) to bind `127.0.0.1` in `end()`. The 7.3 upgrade (#1815) moved server start into `_whenServerReady`, which builds the URL from `this._serverPath` — a field the patch bypassed — so every request URL became `http://127.0.0.1:<port>undefined` and superagent threw `TypeError: Invalid URL` (the canary's 4 tests and 32 of 36 in `auth-route-wiring.test.ts` failed). The canary worked; what let the break through was that the bump was a `package.json`/lockfile-only change, which the push gate's changed-file test selection does not map to any test. When a dependency that `test/setup.ts` patches is bumped, run the canary for that patch by hand before pushing. The patch was deleted.

Count-dependent tests (rate limits, quotas) still need one more thing: a module-level limiter store keeps its counts across vitest retries, so if such a test ever flakes for another reason the retry fails the other way (429 where 200 was expected). Build a fresh module graph per attempt:

```ts
vi.resetModules();
const hub = await import("../profile-hub"); // fresh limiter store
```

and assert every request in the loop was served by the app (status plus an app-only header such as `ratelimit-limit`), so a stray response fails on the request that caused it instead of on the count.

## Related Files

- `test/setup.ts` (the supertest patch, removed 2026-11-09 — supertest 7.3 binds 127.0.0.1 itself)
- `test/supertest-loopback.test.ts` (canary)
- `server/routes/__tests__/profile-hub-rate-limit.test.ts`
