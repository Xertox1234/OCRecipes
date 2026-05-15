---
title: "setState + mutateAsync in Same Microtask Reads Pre-Render State"
track: bug
category: logic-errors
tags: [tanstack-query, react, mutations, stale-closure, hook-params]
module: client
applies_to: ["client/hooks/**/*.ts", "client/screens/**/*.tsx"]
symptoms:
  - "Mutation fires with stale state (typically `null`/`0`) right after `setState`"
  - "Server receives a path or body containing the pre-render value"
  - "Bug only reproduces when both `setState` and `mutateAsync` run in the same handler"
created: 2026-04-18
severity: high
---

# setState + mutateAsync in Same Microtask Reads Pre-Render State

## Problem

`CookSessionCaptureScreen.handleAnalyzePhoto` did:

```typescript
const sid = await ensureSession(); // creates session
setSessionId(sid); // queues a re-render
await addPhoto.mutateAsync(uri); // fires NEXT — sees sessionId=null
```

`addPhoto` was `useAddCookPhoto(sessionId)` — a hook-parameter closure. `setSessionId` schedules a re-render, but the re-render hasn't happened when `mutateAsync` runs on the next microtask. The mutation's `fn` captured `sessionId` from the previous render, which was still `null`. The server received `POST /api/cooking/null/photos` and threw "No active session."

## Symptoms

- Server log shows `null` or `0` in a URL segment or request body where a valid id should be
- The handler clearly sets the value just two lines above
- The bug reproduces every time, not as a race

## Root Cause

A hook with a parameter closure (`useAddCookPhoto(sessionId)`) captures the parameter value at hook-init time. `setSessionId(sid)` schedules a render but does not retroactively update the captured closure inside the mutation that is about to fire. Microtask ordering: `mutateAsync` enqueues before React's commit phase runs, so the in-flight mutation reads the previous render's state.

## Solution

Switch the mutation to accept `sessionId` as a **mutation variable**, not a hook parameter. Variables are read at call time, not at hook-init time:

```typescript
const addPhoto = useAddCookPhoto(); // no sessionId arg
const sid = await ensureSession();
await addPhoto.mutateAsync({ sessionId: sid, photoUri }); // always fresh
```

This is the general rule for any TanStack Query mutation that consumes freshly-set state in the same handler.

## Prevention

- Do not parameterize mutation hooks with state values that change within the same handler. Pass them through `mutateAsync` variables instead.
- The hook parameter pattern is fine for stable identifiers (userId from context, etc.). It breaks for values that flow through state in the same render pass.
- Lint check candidate: warn when a hook returning a mutation closes over a `useState` value that is also `setState`'d in the same component.

## Related Files

- `client/hooks/useCookSession.ts:42-87` — `useAddCookPhoto` refactored
- `client/screens/CookSessionCaptureScreen.tsx:86-114` — thread `sid` through `mutateAsync`
- `docs/patterns/hooks.md` — "Mutation Parameter Over Hook Parameter"

## See Also

- [Async mutation double-tap guard](../design-patterns/async-mutation-double-tap-guard-2026-05-13.md)
- [Dirty-state sync ref callbacks](../design-patterns/dirty-state-sync-ref-callbacks-2026-05-13.md)
