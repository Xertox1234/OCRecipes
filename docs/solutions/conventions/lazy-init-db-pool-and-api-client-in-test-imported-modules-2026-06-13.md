---
title: Lazy-initialize DB pools and API clients in modules that tests import
track: knowledge
category: conventions
module: server
tags: [vitest, ci, database-pool, openai, lazy-init, test-isolation, import-side-effects]
symptoms: [A unit test connects to a real DB or needs an API key even though it only exercises pure logic, 'CI fails at test collection with a connection error, before any test body runs', A module-level `new Pool(...)` or `new OpenAI(...)` runs the instant a test imports the file]
applies_to: [scripts/**/*.ts, server/**/*.ts]
created: '2026-06-13'
---

# Lazy-initialize DB pools and API clients in modules that tests import

## Rule

A module that a `*.test.ts` file imports must **not** construct a DB pool, HTTP/SDK client, or any other live connection at module top level. Build them lazily — behind a factory function or a lazily-populated singleton — and make external clients **injectable** so tests pass a fake.

## Why

Vitest evaluates a module's top-level code at **collection** time, the moment any test imports it — before (and regardless of) `skipIf`/`describe` guards. A module-level `const pool = new Pool(connStr)` therefore opens a connection during `vitest run`, even for a pure unit test. CI has no DB and no API key, so collection fails before a single assertion executes. The fix is to defer construction until the code path that actually needs it runs (never at import).

This is what keeps a DB/AI-backed feature CI-safe: the pure libs import with zero side effects; only operator scripts (run with env vars set) ever construct the real pool/client.

## Examples

Lazy pool factory + injectable embeddings client:

```ts
// db.ts — factory, never a module-level pool
export function createPool(connectionString: string | undefined): Pool {
  if (!connectionString) throw new Error("connection string is required");
  return new Pool({ connectionString });
}

// embeddings.ts — lazy singleton + injectable client default param
let _client: OpenAI | null = null;
export function getClient(): OpenAI {
  if (!_client) {
    const key = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!key) throw new Error("AI_INTEGRATIONS_OPENAI_API_KEY not set");
    _client = new OpenAI({ apiKey: key, baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL });
  }
  return _client;
}
export async function embedBatch(
  texts: string[],
  client: Pick<OpenAI, "embeddings"> = getClient(), // default evaluated at CALL time, not import
): Promise<number[][]> { /* ... */ }
```

The test passes a fake client, so `getClient()` (which reads the key) never fires:

```ts
const fake = { embeddings: { create: vi.fn(async ({ input }) => ({ data: input.map(() => ({ embedding: [0] })) })) } };
await embedBatch(["q"], fake as unknown as Pick<OpenAI, "embeddings">);
```

## Exceptions

Entrypoint scripts that are *never* imported by a test (run via `tsx`, gated behind an env-var check) may construct the pool/client at module scope — there is no test-collection path through them. Keep an integration check that exercises the real DB as a **standalone script**, not a `*.test.ts`, for the same reason.

## Related Files

- `scripts/solutions-db/lib/db.ts`, `scripts/solutions-db/lib/embeddings.ts` — lazy factory / lazy client
- `scripts/solutions-db/integration-check.ts` — standalone (not vitest) real-DB check

## See Also

- [../runtime-errors/pg-pooled-connection-poisoned-without-rollback-in-finally-2026-06-13.md](../runtime-errors/pg-pooled-connection-poisoned-without-rollback-in-finally-2026-06-13.md) — the other half of pool discipline (transaction cleanup)
