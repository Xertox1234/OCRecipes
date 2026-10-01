---
title: A screen that shows a Premium wall for a 403'd query must refetch that query on upgrade — the subscription refresh never touches it
track: knowledge
category: conventions
module: client
tags: [client-state, react-native, tanstack-query, premium]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-09-28'
---

# A Premium wall must refetch the denied query on upgrade

## Rule

When a screen renders a Premium wall because a query failed with 403
`PREMIUM_REQUIRED`, and that wall opens `UpgradeModal`, pass
`onUpgrade={handler}` where the handler refetches **that query**. Keep the
handler stable (`useCallback`) — `onUpgrade` is in `UpgradeModal`'s
auto-close effect deps, so an inline arrow re-arms its 1.5 s timer on every
parent render.

## Why

A successful purchase runs `refreshSubscription()` → `refetchSubscription()`
(`client/context/PremiumContext.tsx`) and nothing else: no
`invalidateQueries`, `resetQueries` or `refetchQueries` anywhere in
`client/lib/iap/` or `PremiumContext.tsx`. The denied query stays in its
error state, and `client/lib/query-client.ts` never retries a 4xx. So the
user pays, sees "Welcome to Premium!", and is left on the same wall with the
same "See Premium" button.

An action that failed on 403 (a Save button) is different: the user can
simply tap it again, so no refetch is needed there.

## Examples

`client/screens/FeaturedRecipeDetailScreen.tsx` (#1149 follow-up):

```tsx
const handleUpgraded = useCallback(() => {
  if (resolvedRecipeType === "catalog") void refetchCatalogDetail();
}, [resolvedRecipeType, refetchCatalogDetail]);
// …
<UpgradeModal visible={showUpgrade} onClose={…} onUpgrade={handleUpgraded} />
```

Test shape: mock `UpgradeModal` to render a button that calls `onUpgrade`,
reject the first GET with a 403 `ApiError` and resolve the next — assert the
recipe renders and the wall is gone.

## Exceptions

- A wall whose content comes from `usePremiumContext()` itself (not from a
  403'd query) re-renders on the subscription refetch and needs no handler.

## Related Files

- `client/screens/FeaturedRecipeDetailScreen.tsx`
- `client/components/UpgradeModal.tsx`
- `client/context/PremiumContext.tsx`
- `client/screens/__tests__/FeaturedRecipeDetailScreen.test.tsx`

## See Also

- [Gate an error EmptyState on no-cached-data](gate-error-emptystate-on-no-cached-data-not-bare-iserror-2026-09-25.md) — the wall itself must also yield to cached data
- [checkPremiumFeature helper](../design-patterns/check-premium-feature-helper-2026-05-13.md) — the server side that sends the 403
