---
title: "An interactive card inside a streamed chat reply loses its local state when the pending bubble is swapped for the saved row"
track: bug
category: logic-errors
tags: [client-state, react-native, hooks, chat, remount]
module: client
applies_to: ["client/screens/RecipeChatScreen.tsx", "client/components/coach/**/*.tsx", "client/components/recipe-finder/**/*.tsx"]
symptoms: ["the user changes a control on a card in a just-streamed reply, and a moment later it snaps back to its defaults", "an action sent from the card carries the prefilled defaults, not what the user picked", "the reset happens only on the newest reply, right after it finishes streaming"]
created: 2026-10-09
severity: high
---

# An interactive card inside a streamed chat reply loses its state on the pending → saved swap

## Problem

RecipeChef renders a streaming reply as a **pending bubble**. When the stream ends and the messages
refetch lands, the pending bubble is replaced by the **saved row** for the same message. That is a
different element in the list, so React unmounts the first card and mounts a new one.

The coach recipe offer's adjust card (#1332) kept the user's servings, spice, time and answers in
`useState`. A user who changed them while the refetch was in flight lost their picks on the swap.
Generate then sent the prefilled defaults.

## Symptoms

- A control on the newest reply's card snaps back to its default a moment after the reply finishes.
- The action the card sends carries the defaults, not the user's picks.
- Older replies are unaffected, because they are already saved rows.

## Root Cause

Local component state lives in the component instance. The pending bubble and the saved row are two
instances of the card for one logical message, and nothing carries state from the first to the second.
Coach Pro has no pending → saved swap, but its list virtualises rows that scroll away, which is the same
remount by another route.

## Solution

Lift the card's choices out of the component, into a per-screen store keyed by a stable id from the
message itself. The adjust card's `flowId` is that id.

```ts
// RecipeChatScreen.tsx and CoachChat.tsx — one store per screen, stable across renders
const [adjustChoices] = useState<AdjustChoicesStore>(() => new Map());
// passed down through RecipeFinderMessage (and BlockRenderer for Coach) to RecipeAdjust
```

The card reads its initial state from `adjustChoices.get(flowId)` (falling back to the prefill) and
writes every change back. A remount of the same flow restores the picks; a new flow starts from its
prefill.

## Prevention

- Any interactive element rendered inside a streamed reply must survive the pending → saved swap. Test
  it directly: render the pending bubble, change a control, swap in the saved row, then assert the value
  and the action payload.
- Key the store by an id that both renderings share (a `flowId` in the block data), never by list index
  or message id. The pending bubble has no saved message id yet.

## Related Files

- `client/components/recipe-finder/recipe-offer-utils.ts` — `AdjustChoicesStore`
- `client/components/recipe-finder/RecipeAdjust.tsx` — reads and writes the store by `flowId`
- `client/screens/RecipeChatScreen.tsx` / `client/components/coach/CoachChat.tsx` — one store per screen
- `client/screens/__tests__/RecipeChatScreen.test.tsx` — the pending → saved swap keeps the picks

## See Also

- [Hook-returned stable component reading a ref goes blank under a compiled host](hook-returned-stable-component-reading-ref-goes-blank-under-compiled-host-2026-10-01.md) — another render-identity trap in the same chat screens
