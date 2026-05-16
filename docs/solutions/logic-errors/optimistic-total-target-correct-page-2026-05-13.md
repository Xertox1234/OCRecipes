---
title: "Optimistic Total Must Target the Correct Page in useInfiniteQuery"
track: bug
category: logic-errors
tags: [react-query, useInfiniteQuery, optimistic-update, pagination, tanstack]
module: client
applies_to: ["client/hooks/**/*.ts", "client/screens/**/*.tsx"]
symptoms:
  - "After optimistic discard, the next page fetch skips or duplicates items"
  - "`page.total` on every page decremented in lockstep, corrupting offsets"
  - "Item counts drift over time as users discard items"
created: 2026-02-12
severity: high
---

# Optimistic Total Must Target the Correct Page

## Problem

When optimistically removing an item from a `useInfiniteQuery` list, the initial implementation decremented `page.total` on every page, not just the page containing the discarded item. This corrupted pagination offsets, causing skipped or duplicate items on subsequent page fetches.

## Symptoms

- Discard an item → next page fetch returns rows the user already saw, or skips rows entirely.
- `page.total` drifts downward faster than the actual item count.
- The bug is silent on the page being viewed (the optimistic remove works) and surfaces only when the user scrolls further.

## Root Cause

`useInfiniteQuery` keeps pages in `data.pages: Page[]`. Each page contains its own slice of items plus the **server's total** (which is the same number on every page, snapshotted at the time the page was fetched).

The naive optimistic update maps over every page and decrements `total`:

```typescript
// ❌ Bug: total decremented on every page
queryClient.setQueryData<InfiniteData<Page>>(["history"], (old) => ({
  ...old,
  pages: old.pages.map((page) => ({
    ...page,
    items: page.items.filter((i) => i.id !== discardedId),
    total: page.total - 1, // ❌ decrements N times for N pages
  })),
}));
```

After one discard with 3 pages loaded, `total` shows `realTotal - 3` instead of `realTotal - 1`. Pagination offsets computed from `total` (e.g., "we've loaded 25 of 47, fetch the next 25 starting at offset 25") drift, and the next `fetchNextPage` call asks the server for the wrong window.

## Solution

The discarded item lives on **one** page. Decrement `total` only on pages that actually shrank, detected by comparing filtered length to original length:

```typescript
queryClient.setQueryData<InfiniteData<Page>>(["history"], (old) => ({
  ...old,
  pages: old.pages.map((page) => {
    const filtered = page.items.filter((i) => i.id !== discardedId);
    const itemWasOnThisPage = filtered.length < page.items.length;
    return {
      ...page,
      items: filtered,
      total: itemWasOnThisPage ? page.total - 1 : page.total,
    };
  }),
}));
```

This keeps `total` consistent across pages: every page should always agree on the server's current total.

## Prevention

- Treat `total` as a per-page snapshot of a **server-wide** quantity. The invariant is "all pages agree." If your optimistic update can violate that invariant, it's wrong.
- Always compare `filtered.length < page.items.length` to detect which page actually contained the removed item.
- Add a regression test: load 3 pages, discard one item, assert `total` on all pages still matches.

## Related Files

- `client/hooks/useDiscardItem.ts` — optimistic remove with per-page total correction

## See Also

- [soft-delete-breaks-aggregation-queries-2026-05-13.md](soft-delete-breaks-aggregation-queries-2026-05-13.md) — Server-side companion: the same discard operation breaks daily summary aggregation if SQL doesn't filter discarded rows.
- [toggle-favourite-race-condition-2026-05-13.md](toggle-favourite-race-condition-2026-05-13.md) — Another mutation on the same history-item flow.
- `docs/legacy-patterns/client-state.md` — "Optimistic Mutation on Infinite Query Pages"
