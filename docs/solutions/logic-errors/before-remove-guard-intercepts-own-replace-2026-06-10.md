---
title: beforeRemove discard guards intercept the screen's own forward REPLACE
track: bug
category: logic-errors
module: client
severity: high
tags: [react-navigation, beforeRemove, navigation-guard, data-loss]
symptoms: [Primary flow shows a destructive discard confirm when the user taps Done, Confirming wipes the context the destination screen reads — silent data loss]
created: '2026-06-10'
source: '2026-06-10 full audit (H3, BatchScanScreen)'
---

## Problem

A `beforeRemove` listener that `preventDefault()`s to show a "Discard?" confirm
also fires for the screen's OWN intentional forward navigation —
`navigation.replace(...)` removes the current screen, so the happy-path "Done"
button triggered the discard dialog, and confirming ran `clearSession()` before
re-dispatching the replace: BatchSummary mounted with an empty session.

## Symptoms

- Primary flow shows a destructive confirm ("Discard scanned items?") when the
  user taps Done.
- Confirming wipes the context/state the destination screen reads — silent data
  loss; the review flow is unreachable with data.

## Root Cause

React Navigation v7 fires `beforeRemove` for ANY action that removes the
screen, including REPLACE dispatched by the screen itself
(`navigation-events.md`). The guard never inspected `e.data.action`.

## Solution

Whitelist the known-safe intentional removal, narrowed to its target so a
future redirect-style REPLACE doesn't bypass the guard, with a runtime shape
check (the payload type is `object | undefined`):

```ts
const { action } = e.data;
if (
  action.type === "REPLACE" &&
  typeof action.payload === "object" &&
  action.payload !== null &&
  "name" in action.payload &&
  (action.payload as { name?: unknown }).name === "BatchSummary"
) {
  return; // our own Done flow — let it through
}
e.preventDefault();
```

## Prevention

When adding a `beforeRemove` guard, enumerate every navigation the screen
itself performs (replace, navigate-forward into a flow) and exempt each by
action type + target. Test the primary forward flow, not just back/dismiss.

## Related Files

- `client/screens/BatchScanScreen.tsx`

## See Also

- docs/audits/2026-06-10-full.md (H3)
- docs/rules/react-native.md
