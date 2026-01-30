---
title: "Fix ItemDetailScreen suggestions fetch (missing auth, manual fetch)"
status: ready
priority: medium
created: 2026-01-30
updated: 2026-01-30
assignee:
labels: [bug, api, code-review]
---

# Fix ItemDetailScreen Suggestions Fetch

## Summary

The suggestions fetch in ItemDetailScreen has two issues: (1) missing Authorization header, and (2) manual fetch instead of TanStack Query, bypassing caching.

## Background

**Location:** `client/screens/ItemDetailScreen.tsx:185-219`

```typescript
const fetchSuggestions = async () => {
  const response = await fetch(
    new URL(`/api/items/${itemId}/suggestions`, getApiUrl()).toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",  // Wrong for JWT auth
      body: JSON.stringify({ productName: item.productName }),
    },
  );
```

**Issues:**
1. No Authorization header (JWT token not sent)
2. Uses `credentials: "include"` which is for cookies, not JWT
3. Manual fetch bypasses TanStack Query cache
4. useEffect depends on `item` object reference (unstable)

## Acceptance Criteria

- [ ] Convert to TanStack Query useQuery
- [ ] Add proper Authorization header via apiRequest
- [ ] Enable caching for suggestions
- [ ] Fix dependency to use stable itemId instead of item object

## Implementation Notes

```typescript
const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
  queryKey: [`/api/items/${itemId}/suggestions`],
  queryFn: async () => {
    const response = await apiRequest(
      "POST",
      `/api/items/${itemId}/suggestions`,
      { productName: item?.productName }
    );
    return response.json();
  },
  enabled: !!item,
  staleTime: 10 * 60 * 1000,  // Cache for 10 minutes
});
```

This also fixes the server-side issue where `requireAuth` is present but the endpoint wasn't receiving the token.

## Dependencies

- None

## Risks

- None - bug fix

## Updates

### 2026-01-30
- Initial creation from code review
