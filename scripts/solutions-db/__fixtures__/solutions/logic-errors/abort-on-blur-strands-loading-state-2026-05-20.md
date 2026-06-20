---
title: Abort-on-blur strands a loading spinner when the main effect deps are stable
track: bug
category: logic-errors
module: client
severity: low
tags: [react, hooks, useFocusEffect, abortcontroller, react-navigation]
symptoms:
  [
    Analysis/loading spinner never clears after the screen regains focus,
    isLoading/isAnalyzing stuck true with no error and no result,
  ]
applies_to: [client/hooks/**/*.ts, client/hooks/**/*.tsx]
created: "2026-05-20"
---

# Abort-on-blur strands a loading spinner when the main effect deps are stable

## Problem

A hook ran a one-shot async task in a `useEffect`, aborting the in-flight request
from a `useFocusEffect` cleanup on blur. The `finally` block only cleared the
loading flag when `!signal.aborted`:

```ts
} finally {
  if (!abortController.signal.aborted) setIsAnalyzing(false); // bug
}
```

On an OS-level blur (notification tray, incoming call) the request aborts, the
`finally` skips the clear, and on refocus nothing restarts the task — so the
spinner is stuck forever.

## Symptoms

- Spinner spins indefinitely; no error, no data.
- Only reproducible via OS-level focus changes, not in-app navigation.

## Root Cause

`useFocusEffect`'s callback re-runs on every refocus, but the **separate** main
`useEffect` that drives the task only re-runs when its dependency array changes.
When those deps are stable for the screen's lifetime (e.g. `[imageUri, intent]`,
set once on mount), the task never restarts after the blur-triggered abort. The
guarded state-clear then leaves the terminal loading flag set with no path to
clear it.

## Solution

Always clear the terminal loading state in `finally`, regardless of abort:

```ts
} finally {
  // useFocusEffect cleanup aborts on blur, but the main effect's deps are stable
  // so it never re-runs on refocus — a guarded clear strands the spinner.
  // Harmless no-op if the component is already unmounted (React 18+).
  setIsAnalyzing(false);
}
```

## Prevention

- An abort path must always have a corresponding **terminal-state clear** or a
  **restart-on-refocus** — never leave the UI in a pending state with no exit.
- Calling `setState` after unmount is a no-op in React 18+ (not a leak), so the
  unconditional clear is safe; do not re-add an `aborted`/`mounted` guard around
  it (that re-introduces the strand). External reviewers without app context may
  flag the unconditional clear — keep the explanatory comment so the trade-off is
  visible.
- Distinct from `useeffect-cleanup-memory-leak.md`: that is about _running_
  cleanup; this is about cleanup leaving state _unrecoverable_.

## Related Files

- `client/hooks/usePhotoAnalysis.ts` — the `finally` block + `useFocusEffect` cleanup

## See Also

- `docs/audits/2026-05-20-full.md` — finding L10
- `docs/solutions/logic-errors/useeffect-cleanup-memory-leak.md`
