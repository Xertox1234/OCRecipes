---
title: A reset that clears a single-flight init guard mid-flight defeats it — await the in-flight init before resetting
track: bug
category: logic-errors
module: server
severity: medium
tags: [concurrency, single-flight, race-condition, minisearch, search-index]
symptoms: ['A rebuild/refresh endpoint intermittently 500s under concurrent calls (admin double-click, retry, rebuild right after deploy)', MiniSearch throws a duplicate-ID error from addAll(), 'The in-memory index is briefly left empty after the throw, then self-heals on the next read', Single calls always succeed; only overlapping calls fail (classic race)]
applies_to: [server/services/recipe-search.ts, server/lib/search-index.ts]
created: '2026-06-25'
---

# A reset that clears a single-flight init guard mid-flight defeats it — await the in-flight init before resetting

## Problem

A module owns a lazily-built singleton (an in-memory MiniSearch index) guarded by a single-flight `initPromise` so concurrent first-callers coalesce instead of each re-running the DB load + `addAll`. A new **rebuild** operation was added to refresh the live index without a restart:

```ts
// BROKEN — not serialized against concurrent callers or an in-flight init
export async function rebuildSearchIndex(): Promise<{ total: number }> {
  resetSearchIndex();        // nulls initPromise + clears the index
  await initSearchIndex();
  return { total: getDocumentStore().size };
}
```

`resetSearchIndex()` nulls `initPromise`. When two rebuilds overlap — or a rebuild lands while the fire-and-forget **boot init** (`routes.ts` → `initSearchIndex().catch(...)`) is still in its DB read — the second `reset` nulls the first init's `initPromise` *mid-flight*, defeating the `if (initPromise) return initPromise` guard. Two inits then run in parallel; whichever resumes second calls `idx.addAll(docs)` on an already-populated index and MiniSearch throws on duplicate IDs.

## Symptoms

- `POST /api/admin/search-index/rebuild` (or any rebuild path) intermittently 500s under concurrent calls.
- MiniSearch throws a duplicate-ID error from `addAll()`.
- The index is briefly empty (the throwing init's catch resets it) until the next search re-initializes it — so users may see a transient empty result set, then recovery.
- Reproduces only on overlap; a single call always works.

## Root Cause

The single-flight guard `if (initPromise) return initPromise` only holds if **nothing clears `initPromise` during an in-flight init**. `resetSearchIndex()` is exactly such a clear. This is a *different* failure mode from the classic "lock set after an inserted `await`": here the lock is set correctly and at the right time, but a **sibling operation (`reset`) nulls it** while a build is in flight. Both inits then pass the guard and double-`addAll`.

## Solution

Serialize the rebuild with its own single-flight promise **and** await any in-flight init *before* resetting:

```ts
let rebuildPromise: Promise<{ total: number }> | null = null;

export async function rebuildSearchIndex(): Promise<{ total: number }> {
  if (rebuildPromise) return rebuildPromise;            // 1. coalesce concurrent rebuilds
  rebuildPromise = (async () => {
    if (initPromise) await initPromise.catch(() => {}); // 2. let any in-flight init finish first
    resetSearchIndex();                                  //    now safe to clear the guard
    await initSearchIndex();                             //    init's own guard coalesces the re-init
    return { total: getDocumentStore().size };
  })();
  try {
    return await rebuildPromise;
  } finally {
    rebuildPromise = null;
  }
}
```

Why it is correct:

- `rebuildPromise` coalesces concurrent rebuilds onto one run (the second caller awaits the first instead of racing past `reset`).
- Awaiting `initPromise` before `resetSearchIndex()` means the reset never yanks an init's promise out from under it. There is **no `await` between the awaited init resolving and the synchronous `reset`**, so nothing interleaves there (single-threaded).
- Continuation-registration order guarantees the original init's own `finally { initPromise = null }` runs before the rebuild's `await initPromise` continuation — so the rebuild's *fresh* init promise is never nulled by the old init's `finally`.
- Reader safety is separate and already held: `resetSearchIndex` **reassigns** `documentStore` to a new `Map` rather than mutating it, so a search already past the `isIndexInitialized()` check reads the old Map consistently and never sees an empty index.

## Prevention

- Any operation that **resets** a singleton guarded by a single-flight promise must (a) coalesce its own callers and (b) await the in-flight build before clearing the guard. Treat "who else can null this promise?" as a required question when adding a reset/rebuild path.
- Test the race deterministically: make the storage loader resolve on a later tick, fire `Promise.all([rebuild(), rebuild()])`, and assert the loaders ran **exactly once** (proves coalescing) and neither call threw. Add a "rebuild overlaps boot init" case that throws *without* the fix.

## Related Files

- `server/services/recipe-search.ts` — `rebuildSearchIndex()`, `initSearchIndex()`, `resetSearchIndex()`.
- `server/lib/search-index.ts` — the `resetSearchIndex` primitive reassigns `documentStore` to a fresh `Map`.
- `server/services/__tests__/recipe-search.test.ts` — concurrency regression tests (`describe("rebuildSearchIndex")`).

## See Also

- [single-flight lock must precede first await](sync-lock-must-precede-first-await-single-flight-guard-2026-06-20.md) — sibling: the lock-set-too-late variant of the same single-flight guard failure.
