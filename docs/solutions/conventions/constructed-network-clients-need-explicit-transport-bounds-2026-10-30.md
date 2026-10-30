---
title: "Every constructed network client (OpenAI SDK, S3Client, pg Pool) sets explicit timeouts — their defaults are unbounded or ~30 minutes"
track: knowledge
category: conventions
tags: [api, architecture, database, timeout, external-api, reliability, ai-routing]
module: server
applies_to: ["server/lib/**/*.ts", "server/db.ts", "server/services/**/*.ts"]
created: 2026-10-30
---

# Constructed network clients need explicit transport bounds

## Rule

When you call `new OpenAI(...)`, `new S3Client(...)`, `new Pool(...)` or any other long-lived SDK client, set its timeout options at construction. Don't rely on per-call timeouts that some callers forget to pass. The defaults for these three clients either never time out or allow about 30 minutes:

| Client | Default | Project setting |
| ------ | ------- | --------------- |
| `openai` SDK (OpenRouter, Vertex, direct OpenAI) | `timeout` 600 000 ms, `maxRetries` 2 → up to 3 × 10 min | `timeout: AI_ROUTE_TIMEOUT_MS` (45s), `maxRetries: AI_ROUTE_MAX_RETRIES` (1), both in `server/lib/ai-failure.ts`. The direct client uses `OPENAI_DEFAULT_TIMEOUT_MS` (45s) in `server/lib/openai.ts` |
| `@aws-sdk/client-s3` (R2) | `connectionTimeout` 0, `requestTimeout` 0 (no limit) | `requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000, throwOnRequestTimeout: true }` |
| `pg` `Pool` | `connectionTimeoutMillis` 0 (wait forever for a client), no `statement_timeout`, no idle-in-transaction limit | `connectionTimeoutMillis: 5_000`, `statement_timeout` 30 000 (override with `DB_STATEMENT_TIMEOUT_MS`), `idle_in_transaction_session_timeout: 60_000` |

## Why

Reliability audit 2026-10-30, findings R07, R10, R11 and N2:

- **OpenAI SDK.** The direct-OpenAI client already had a 45s default. The OpenRouter and Vertex clients built in `ai-client.ts` and `vertex-client.ts` did not. `front-label-scan` and `coach-notebook-extract` pass no per-call timeout, so a stalled route could block for about 30 minutes before `aiChat`'s fallback chain ran. Use only one retry because `aiChat` already falls back to another route. OpenRouter construction is now `createOpenRouterClient(env)`, which can be tested without network.
- **S3 / R2.** `requestTimeout` alone **only logs a warning** unless `throwOnRequestTimeout: true` is also set. The full root cause is owned by [AWS SDK request timeouts need throwOnRequestTimeout](../logic-errors/aws-sdk-request-timeout-only-warns-without-throw-flag-2026-10-29.md).
- **pg.** If pool acquire has no limit, pool exhaustion (lock contention, a DB brownout) queues every request indefinitely. `statement_timeout` is passed as a startup GUC, so the server enforces it, and it also bounds waits on `pg_advisory_xact_lock`. A one-off script that runs one large unbatched statement raises or disables the cap with `DB_STATEMENT_TIMEOUT_MS`. `idle_in_transaction_session_timeout` makes Postgres end a session that leaked mid-transaction (a missed release, or an `await` that never settles inside `db.transaction`), so its row and advisory locks are released. Keep the existing `options: "-c timezone=UTC"` pin next to these settings.

## Examples

Pin each client with a test that inspects the constructed config. Don't wait for a real hang:

- `server/__tests__/db.test.ts` — asserts the pool options, including the `DB_STATEMENT_TIMEOUT_MS` override
- `server/lib/__tests__/image-store.test.ts` — asserts `requestHandler` including `throwOnRequestTimeout`
- `server/lib/__tests__/ai-client-openrouter.test.ts`, `vertex-client.test.ts` — assert `timeout` and `maxRetries` on the constructed client

## Related Files

- `server/lib/ai-failure.ts` — `AI_ROUTE_TIMEOUT_MS`, `AI_ROUTE_MAX_RETRIES`
- `server/lib/ai-client.ts` — `createOpenRouterClient`
- `server/lib/vertex-client.ts` — `createVertexClient`
- `server/lib/image-store.ts` — R2 `S3Client`
- `server/db.ts` — `pool`

## See Also

- [OpenAI SDK timeout and tiered error handling](../design-patterns/openai-sdk-timeout-and-error-handling-2026-05-13.md) — per-call tiers, and why the timeout applies to one attempt, not the whole request
- [Fetch timeout with AbortSignal for every external API call](./fetch-timeout-abort-signal-external-apis-2026-05-13.md) — the same rule for bare `fetch`
- [node-postgres pooled connection is poisoned without ROLLBACK in finally](../runtime-errors/pg-pooled-connection-poisoned-without-rollback-in-finally-2026-06-13.md)
