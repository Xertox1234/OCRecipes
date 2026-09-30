---
title: "A deep-link-reachable screen must do its own tier routing — the in-app entry point's premium gate does not cover it"
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, deep-linking, premium-gate, client-state]
applies_to: [client/screens/**/*.tsx, client/navigation/linking.ts]
created: 2026-09-30
---

# A deep-link-reachable screen must do its own tier routing — the in-app entry point's premium gate does not cover it

## Rule

If a screen is registered in `client/navigation/linking.ts`, any tier-dependent choice it makes (which screen a row opens, which variant it renders) must be made **inside that screen**, from `usePremiumFeature(...)` / `usePremiumContext()`. Do not rely on the fact that the only in-app button leading to it is shown to premium users — a deep link skips that button.

While premium status is still loading, route to the **premium** target when that target already handles a non-premium viewer gracefully (the same "assume access while loading" rule the premium screen itself uses), so a paying user is never bounced to the free screen by a slow fetch.

## Smell patterns

- A screen with no `usePremium*` call whose rows navigate to a premium-only screen, and whose only in-app entry point sits behind a premium check — including an indirect one, such as a tier-chosen navigator `initialRouteName`.
- Free and premium records share one type with no discriminator (e.g. coach conversations are all `type: "coach"` in `shared/schema.ts`), so the record itself cannot say which screen should open it.

## Why

`AllConversationsScreen` is reachable by the `conversation-list` deep link, but its in-app entry ("See all" in `CoachProScreen`) is reached only by Coach Pro users — the button has no gate of its own; `ChatStackNavigator`'s `coachInitialRoute(isCoachPro)` sends free users to `ChatList` instead of `CoachPro`, so they never see it. Its coach rows always opened `CoachPro`, so a free-tier user arriving by link landed in Coach Pro instead of the plain `Chat` screen `ChatListScreen` rows use (#1192). Nothing crashed — `CoachProScreen` tolerates `isCoachPro === false` — so no test or error surfaced it; it was found in #1184's review once the row tap started working.

## Examples

```tsx
// client/screens/AllConversationsScreen.tsx (#1192) — mirrors CoachProScreen's own gate
const { isLoading: isPremiumLoading } = usePremiumContext();
const isCoachPro = usePremiumFeature("coachPro");
const showCoachPro = isCoachPro || isPremiumLoading;

navigation.navigate(
  "Main",
  {
    screen: "CoachTab",
    params: showCoachPro
      ? { screen: "CoachPro", params: { selectedConversationId: conv.id } }
      : { screen: "Chat", params: { conversationId: conv.id } },
  },
  { pop: true },
);
```

Add `showCoachPro` to the `renderItem` `useCallback` deps, and test the free-tier branch **and** the loading branch.

## Exceptions

- `isLoading` is `false` after a subscription fetch **error** too, with features defaulting to free. For a per-tap route like the one above that is acceptable (the viewer still reaches the same conversation, and the next tap re-evaluates). For a **mount-once** decision, use `isPremiumResolved` instead — see the See Also link.
- A screen that is not in `linking.ts` and has exactly one gated entry point can rely on that gate, but re-check when a deep link is added later.

## Related Files

- `client/screens/AllConversationsScreen.tsx` — coach-row `onPress`
- `client/screens/CoachProScreen.tsx` — the `isCoachPro || isPremiumLoading` precedent
- `client/screens/ChatListScreen.tsx` — free-tier row target (`Chat`)
- `client/navigation/linking.ts` — `conversation-list` path
- `client/navigation/ChatStackNavigator.tsx` — `coachInitialRoute(isCoachPro)`, the indirect gate on "See all"
- `client/context/PremiumContext.tsx` — `isLoading` vs `isPremiumResolved`

## See Also

- [isLoading=false on error is not resolved](isloading-false-on-error-not-resolved-2026-06-12.md) — mount-once gates need `isPremiumResolved`
- [Bare navigate cannot descend into an unrelated nested navigator](../logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md) — the nested `{ pop: true }` form this route keeps (#1184)
