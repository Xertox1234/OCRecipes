# Database Rules

- Never use `onConflictDoNothing({ target })` with partial unique indexes — omit the target arg entirely (PG rejects at runtime; causes live test failures)
- Use `onConflictDoUpdate` for cache tables, not `onConflictDoNothing` — the latter silently skips expired-entry updates, causing `!`-assertion crashes on the stale row
- Always pair `.default([])` with `.notNull()` on array columns — `.default([])` alone keeps the TS type `T[] | null` and crashes on legacy NULLs
- Polymorphic FK always requires a discriminator column (e.g., `recipeType`) alongside the FK — never a bare `recipeId` without type context
- Never store large blobs (images, receipts > 1 KB) in DB columns — use file/object storage (Cloudflare R2)
- Multi-phase background jobs: design the eligibility query to catch phase-1-complete + phase-2-incomplete as a retriable state, not a dead end
- Always use `Promise.all` for parallel queries inside transactions — never sequential `await` (causes N sequential round-trips)
- Never re-query after an insert to build the response — construct from insert params + returned id in-memory
- Polymorphic batch fetch: collect IDs first, batch with `.inArray()`, resolve with `Map` lookup — never loop-query
- Replace-by-DELETE-then-INSERT: dedupe the input array with `[...new Set(ids)]` before insert when removing `onConflictDoNothing`; DELETE alone does not prevent duplicate-row failures on a (userId, x) unique constraint when caller-supplied ids contain repeats
- Never accept a filter parameter in a storage function's type signature that the SQL query does not actually consume — silently dropped filters cause downstream personalization/label bugs (callers expect filtering or boosting that never happens)
- `CURRENT_TIMESTAMP` and `now()` return transaction-start time — for tests that need distinct `createdAt` ordering within one transaction, pass explicit `new Date(baseTime - N)` values; do not rely on `setTimeout` between inserts
