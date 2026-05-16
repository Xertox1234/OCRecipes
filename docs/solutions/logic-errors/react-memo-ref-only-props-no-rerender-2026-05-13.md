---
title: "React.memo + Ref-Only Props = Component That Never Updates"
track: bug
category: logic-errors
tags: [react, react-memo, useRef, hook-returned-component, confirmation-modal]
module: client
applies_to: ["client/hooks/useConfirmationModal.ts", "client/hooks/**/*.ts"]
symptoms:
  - "Confirmation dialog shows stale title/message from a previous `confirm()` call"
  - "Memoized inner component never re-renders despite ref changes"
  - "Shallow comparison sees identical props because all props are refs"
created: 2026-03-25
severity: medium
---

# React.memo + Ref-Only Props = Component That Never Updates

## Problem

The `useConfirmationModal()` hook returns a `ConfirmationModal` component. The inner component received options via a ref (for stable identity) and was wrapped in `React.memo` for performance. When `React.memo` wraps a component whose props are all refs, shallow comparison sees no change on any re-render — the component never updates even after the ref's `.current` value changed. The confirmation dialog showed stale title/message from the previous `confirm()` call.

## Symptoms

- Open the dialog, see correct content. Close, reopen with different options — old content still shown.
- Props look correct in DevTools (refs); they just never trigger memo bypass.
- Removing `React.memo` makes the bug disappear.

## Root Cause

`React.memo` does a shallow comparison of props. Refs are stable by design — `useRef()` returns the same object every render. The `.current` mutation is invisible to shallow comparison. With _only_ refs as props, every render's prop snapshot is identical to the previous one, so `React.memo` always bails out. This is the inverse of the common "use refs to avoid re-renders" pattern: here we actually want re-renders, but refs combined with memo prevent them.

## Solution

Remove `React.memo` from the inner component, or include a non-ref prop that drives re-renders. The hook now uses a `revision` counter state that increments on each `confirm()` call:

```typescript
// Wrong — React.memo blocks all re-renders; refs never change identity
const ConfirmationModalInner = React.memo(function Inner({
  optionsRef,
  sheetRef,
}) {
  // optionsRef.current changed, but optionsRef identity didn't → memo blocks
});

// Right — no memo; revision counter drives re-renders
function ConfirmationModalInner({ optionsRef, sheetRef, revision }) {
  // revision changes on each confirm() → re-render → reads fresh ref
}
```

## Prevention

- `React.memo` does shallow comparison. Refs are stable by design and never trigger memo bypass.
- When using refs for data that changes, you need an external mechanism — a counter, a state value — to drive re-renders.
- Audit `React.memo` wrappers on hook-returned components: if all props are refs/functions, the memo is either pointless (no perf gain) or wrong (blocks updates).

## Related Files

- `client/hooks/useConfirmationModal.ts` — removed `React.memo`, added `revision` counter
- `docs/legacy-patterns/hooks.md` — "Hook-Returned Component Pattern for BottomSheetModal"

## See Also

- [useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
