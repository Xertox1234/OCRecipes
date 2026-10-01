---
title: "An unmount-only cleanup effect that lists a state dep reruns on ANY change to it, not just at unmount"
track: bug
category: logic-errors
tags: [react-native, hooks, useeffect, cleanup, race, client-state]
module: client
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
symptoms: ["A newly-created resource (XHR, subscription, timer) gets torn down immediately after being created, with no visible unmount", "A screen's first send/action after creating a new record silently fails or produces no visible result", "An effect whose only job is 'run this cleanup on unmount' includes a piece of state that also changes during normal use"]
created: '2026-09-29'
severity: high
---

# An unmount-only cleanup effect that lists a state dep reruns on ANY change to it, not just at unmount

## Problem

`RecipeChatScreen`'s abort-on-unmount effect:

```tsx
useEffect(() => {
  return () => {
    abortStream();
    if (isStreaming && conversationId) markPendingRecipeTurn(conversationId);
  };
}, [abortStream, conversationId, markPendingRecipeTurn]);
```

was written to run its cleanup ONLY when the screen unmounts. But `conversationId` is not
unmount-only state — it flips from `null` to a real id the moment a brand-new chat is created,
and `handleSend` calls `setConversationId(convId)` immediately before (no `await` between)
`void sendMessage(content, undefined, convId)`. React reruns ANY effect whose dependency array
changed — cleanup-then-setup — regardless of intent; there is no "only tears down on unmount"
mode. The cleanup fired on that exact transition, calling `abortStream()` unconditionally as its
first line, which aborted the just-started XHR before it streamed anything. The user's own first
message silently vanished: no error, no content, `isStreaming` just ends.

## Symptoms

- A resource (XHR, subscription, timer) the effect just set up gets torn down almost immediately,
  with no real unmount in between.
- A "does X on unmount" comment is accurate about INTENT but not about when the cleanup actually
  runs.
- The bug is invisible in tests that assert on a mocked hook's return value unless the test drives
  the SAME real state transition through the real component.

## Root Cause

`useEffect(setup, deps)`'s cleanup is not "runs at unmount" — it is "runs before the NEXT setup,
for any reason deps changed, AND at unmount." Any dep that can also change during ordinary use
(not only mount/unmount) makes the cleanup a mid-life event too. A synchronous `setState`
immediately followed by (not awaited before) an async call that itself does async work before
creating the very resource the cleanup manages is exactly the shape that turns "the effect's deps
only change here" into "the deps changed while the resource I depend on doesn't exist yet."

## Solution

Mirror the state into a `useRef` (matching whatever OTHER state the effect already needs to read
freshly — e.g. `isStreamingRef` here) and read the ref inside the cleanup instead of listing the
state as a dep. Keep only genuinely mount/unmount-scoped identities in the deps array (a
`useCallback`-stable function is fine; state a user action can change mid-life is not):

```tsx
const conversationIdRef = useRef(conversationId);
useEffect(() => {
  conversationIdRef.current = conversationId;
}, [conversationId]);

useEffect(() => {
  return () => {
    abortStream();
    if (isStreamingRef.current && conversationIdRef.current) {
      markPendingRecipeTurn(conversationIdRef.current);
    }
  };
}, [abortStream, markPendingRecipeTurn]); // both useCallback-stable — this now only fires at real unmount
```

## Prevention

- Before adding ANY value to an "on unmount" effect's deps array, ask: can this value change for a
  reason OTHER than mount/unmount? If yes, mirror it to a ref instead (`docs/rules/hooks.md`'s
  existing ref-mirroring rule) — do not add it to the array just because the linter's
  `exhaustive-deps` wants it satisfied.
- A `setState` immediately followed (no `await` between) by an async call that reads OTHER state
  derived from that same setState is a specific shape to watch for: the async call's own
  pre-resource-creation `await`s (e.g. `await tokenStorage.get()`) can resolve slower OR faster
  than React's batched re-render, so the ordering is a genuine race, not a guaranteed-safe
  sequence.
- Write the regression test through the REAL component and REAL state transition, not by asserting
  on the mocked hook's return value directly — a mock that never re-renders can't reproduce a
  dependency-array bug at all.

## Related Files

- `client/screens/RecipeChatScreen.tsx` — the fixed effect (`isStreamingRef`/`conversationIdRef`)
- `client/screens/__tests__/RecipeChatScreen.test.tsx` — the regression test ("does not abort the
  just-started send when conversationId transitions from null to a real id")
- `docs/rules/hooks.md` — the general ref-mirroring rule this specializes

## See Also

- [Effect cleanup must read timer refs at cleanup time, not setup time](effect-cleanup-must-read-timer-refs-at-cleanup-2026-05-13.md)
