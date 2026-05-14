---
title: "Pagination with TanStack useInfiniteQuery + server-side cap"
track: knowledge
category: design-patterns
tags: [api, pagination, tanstack-query, react-native, offset-limit]
module: client
applies_to:
  ["client/hooks/**/*.ts", "client/screens/**/*.tsx", "server/routes/**/*.ts"]
created: 2026-05-13
---

# Pagination with TanStack useInfiniteQuery + server-side cap

## When this applies

Any paginated list rendered with FlatList/SectionList that needs progressive loading. The pattern pairs `useInfiniteQuery` on the client with server-side validation and capping of the `limit` parameter.

## Why

`useInfiniteQuery` handles offset tracking, cache merging, and `hasNextPage` calculation automatically — far less manual state than rolling your own paging. The server-side cap is non-negotiable: without it a client can request `?limit=999999` and overload the database.

## Examples

```typescript
const PAGE_SIZE = 50;

async function fetchScannedItems({
  pageParam = 0,
}): Promise<PaginatedResponse> {
  const token = await tokenStorage.get();
  const baseUrl = getApiUrl();
  const url = new URL("/api/scanned-items", baseUrl);
  url.searchParams.set("limit", PAGE_SIZE.toString());
  url.searchParams.set("offset", pageParam.toString());

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  return await res.json();
}

const {
  data,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isLoading,
  refetch,
} = useInfiniteQuery<PaginatedResponse>({
  queryKey: ["api", "scanned-items"],
  queryFn: fetchScannedItems,
  getNextPageParam: (lastPage, allPages) => {
    const totalFetched = allPages.reduce(
      (sum, page) => sum + page.items.length,
      0,
    );
    return totalFetched < lastPage.total ? totalFetched : undefined;
  },
  initialPageParam: 0,
});

// Flatten pages for FlatList
const allItems = data?.pages.flatMap((page) => page.items) ?? [];
```

Server-side validation and capping:

```typescript
app.get("/api/scanned-items", requireAuth, async (req, res) => {
  const limit = parseQueryInt(req.query.limit, {
    default: 50,
    min: 1,
    max: 100,
  });
  const offset = parseQueryInt(req.query.offset, { default: 0, min: 0 });

  const result = await storage.getScannedItems(req.userId!, limit, offset);
  res.json(result);
});
```

`parseQueryInt` replaces the older inline `Math.min/Math.max(parseInt(req.query.x as string) || N, ...)` idiom — see the Express 5 type-safety helpers for the canonical implementation.

## See Also

- [parseQueryInt typed query parameter parsing](parse-query-int-typed-query-parameter-2026-05-13.md)
