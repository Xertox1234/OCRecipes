---
title: React 19 finally-block batching collapses setState calls in same synchronous frame
track: bug
category: logic-errors
module: client
severity: high
tags: [react-19, batching, setstate, error-handling, useeffect]
symptoms: [Error message never appears in UI despite setRequestError(errorMsg), Set-then-clear pattern inside try/finally collapses to the cleared value, Error state set in the same synchronous frame as a finally-block reset never renders]
applies_to: [client/hooks/**/*.ts, client/screens/**/*.tsx]
created: '2026-05-01'
---

# React 19 finally-block batching collapses setState calls in same synchronous frame

## Problem

In a React 19 hook, this sequence produces a silent no-op — the error state is never shown:

```typescript
// Bug — all three calls batch into a single render, netting to null
if (!res.ok) {
  setRequestError(errorMsg); // sets error
  return;                    // exits try block
}
// ...
} finally {
  setRequestError(null);     // "clears" — but batches with the set above → null wins
}
```

React 19's automatic batching flushes all state updates from a single synchronous frame together. `setRequestError(errorMsg)` and `setRequestError(null)` are both enqueued before the component re-renders, so the component sees only the last value: `null`. The error message is invisible.

## Symptoms

- Error UI never renders after a failed request
- Reverting to React 18 makes the error appear briefly before being cleared
- `console.log` shows both setState calls firing but the component sees only the last

## Root Cause

React 19 promotes automatic batching to all event boundaries including async ones. When `setState(x); return; finally { setState(null) }` all run in the same microtask, React batches them into one update. The final write wins; the intermediate write is invisible.

## Solution

Do not clear `requestError` in `finally`. Instead, clear it at the start of the next user action:

```typescript
// Correct — clear only at the start of the next send, not in finally
const sendMessage = useCallback(async (content: string) => {
  setRequestError(null); // clear stale error from previous send
  setIsStreaming(true);
  // ...
  if (!res.ok) {
    setRequestError(errorMsg);
    return;
  }
  // ...
  } finally {
    setIsStreaming(false);
    // requestError intentionally NOT cleared here — React 19 automatic batching
    // would collapse setRequestError(msg) + return + finally { setRequestError(null) }
    // into null before the component re-renders.
  }
}, [...]);
```

If a fullScreenModal unmounts on dismiss, the stale `requestError` state never persists across navigation — each mount starts fresh.

## Prevention

In React 19, `setState(x); return; finally { setState(null) }` in the same synchronous frame batches to `null` before re-render. Never rely on `finally` to "show-then-hide" state — set the new value and let the **next user action** clear it.

## Related Files

- `client/hooks/useChat.ts` — `useSendMessage`, `requestError` state handling
