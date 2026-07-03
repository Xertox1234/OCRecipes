---
title: Paginate List Endpoints With Default + Max Limits
track: knowledge
category: conventions
module: server
tags: [pagination, performance, oom, api, flatlist, infinite-scroll]
applies_to: [server/routes/**/*.ts, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Paginate List Endpoints With Default + Max Limits

## Rule

Every list endpoint paginates. Default page size 20-50, hard maximum 100.
Clients request more via offset or cursor; the server never returns the full
collection in one response.

## Smell patterns

- `storage.getAllX(userId)` returning an unbounded array.
- `res.json(items)` where `items` has no `limit` parameter feeding it.
- A `parseInt(req.query.limit)` without a `Math.min(..., MAX)` clamp.
- An Express route that loops a result set into memory for "just the totals"
  before paginating.
- Client `<FlatList>` rendering a result without virtualization assumptions.

## Why

An unpaginated endpoint on a growing table eventually fails in three ways:

- **OOM on the client.** Large JSON responses (>10MB) crash mobile devices.
- **Slow network transfers.** Mobile networks make the 10MB payload feel
  hostile.
- **UI freeze.** Rendering a huge list without virtualization locks up the
  thread.

Adding pagination after the table grows requires touching every screen at
once. Adding it upfront costs a few lines per endpoint and is invisible to
clients that still pass `limit=20` defaults.

## Examples

### Before — unbounded

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const items = await storage.getAllScannedItems(req.userId);
  res.json(items); // Could be 10,000+ items
});
```

### After — paginated with clamped limit

```typescript
app.get("/api/scanned-items", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;
  const result = await storage.getScannedItems(req.userId, limit, offset);
  res.json(result);
});
```

Two protections in one line: the `|| 50` default catches missing/invalid
input, and `Math.min(..., 100)` caps anyone trying to fetch the world in a
single call.

### Client — virtualize and use `useInfiniteQuery`

`<FlatList>` virtualizes by default. Pair the paginated endpoint with
`useInfiniteQuery` from TanStack Query so the client requests the next page
when the user scrolls near the end.

## Exceptions

- **Bounded collections.** A user's day-of-week settings, a list of tier
  features — small, fixed-size lookups don't need pagination.
- **Admin/internal endpoints** that explicitly need a full export. Even then,
  prefer streaming or chunked responses with an opt-in flag, not an
  unconditional unbounded return.

## Related Files

- `server/routes/scanned-items.ts` — paginated endpoint pattern.
- `client/hooks/useScannedItems.ts` — `useInfiniteQuery` pairing.

## See Also

- [batch-fetch-with-inarray-fix-n-plus-one](../design-patterns/batch-fetch-with-inarray-fix-n-plus-one-2026-05-13.md) —
  pagination plus batch fetch eliminates both unbounded responses and N+1.
- [indexes-for-foreign-keys-and-sort-columns](indexes-for-foreign-keys-and-sort-columns-2026-05-13.md) —
  pagination is fast only if the sort column is indexed.
