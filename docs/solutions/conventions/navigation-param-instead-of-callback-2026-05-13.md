---
title: "Navigation param instead of callback for cross-screen communication"
track: knowledge
category: conventions
tags: [react-native, navigation, params, serializable, picker]
module: client
applies_to: ["client/screens/**/*.tsx", "client/navigation/**/*.ts"]
created: 2026-05-13
---

# Navigation param instead of callback for cross-screen communication

## Rule

Never pass a function as a route param. React Navigation serializes params for deep linking, DevTools inspection, and state persistence — functions are not serializable and will fail silently or crash in these contexts.

Instead, use a serializable param to carry the selection, consume it with `useEffect` in the target screen, then clear it with `setParams` so it doesn't re-apply on future focus.

## Examples

```typescript
// BAD: function in route params — not serializable
// AllConversations: { onSelect: (id: number) => void }
navigation.navigate("AllConversations", { onSelect: setConversationId });

// GOOD: serializable param carries the selection
// AllConversations: undefined
// CoachPro: { selectedConversationId?: number } | undefined
```

Sender (picker screen that passes a result back):

```typescript
// Navigate to the destination with the selected value
// React Navigation resolves CoachPro in the stack and updates its params
navigation.navigate("CoachPro", { selectedConversationId: conv.id });
```

Receiver (screen that acts on the selection):

```typescript
const route = useRoute<RouteProp<ChatStackParamList, "CoachPro">>();

useEffect(() => {
  const selected = route.params?.selectedConversationId;
  if (selected == null) return; // == null catches both null and undefined; allows 0 as valid ID
  setConversationId(selected);
  navigation.setParams({ selectedConversationId: undefined }); // prevent re-apply on focus
}, [route.params?.selectedConversationId, navigation]);
```

**Effect ordering:** Declare the param-reading effect BEFORE any default-selection effect so the explicit selection wins. The default-selection guard (`if (conversationId || ...)`) prevents clobbering after state is set.

**When the receiver is in a different stack:** the sender needs a 3-level `CompositeNavigationProp` to reach across the navigator boundary.

## Why

Non-serializable params break:

- State persistence (`@react-navigation/native` `linking.getStateFromPath`)
- Deep linking (URL → state restoration)
- DevTools inspection
- Redux DevTools snapshot / time travel

Even when none of those are active today, the silent failure mode (function reference becomes `undefined` after restore) is hard to debug.

## Exceptions

When to use: any picker/selector modal that needs to return a selection to the calling screen.

When NOT to use: Passing display data _to_ a screen (not back from it) — that's a normal forward param, no special handling needed.

## Related Files

- `client/screens/AllConversationsScreen.tsx` — sender navigates to `CoachPro` with `selectedConversationId`
- `client/screens/CoachProScreen.tsx` — receiver consumes and clears via `setParams`
- `client/types/navigation.ts` — `AllConversationsNavigationProp` 3-level composite type
- Origin: H6 audit finding (2026-05-09)

## See Also

- [CompositeNavigationProp for cross-stack navigation](../design-patterns/composite-navigation-prop-cross-stack-2026-05-13.md)
