---
title: Mutation onError Missing cancelled Guard After Unmount
track: bug
category: logic-errors
module: client
severity: medium
tags: [tanstack-query, mutations, unmount, cancelled-ref, useEffect]
symptoms: [Unmounted-component warnings after a network error in a `useEffect`-launched mutation, '`onSuccess` guards with a `cancelled` ref but `onError` does not', Mutation `onError` path mutates state on a screen that has already unmounted]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-04-28'
---

# Mutation onError Missing cancelled Guard After Unmount

## Problem

`ReceiptReviewScreen` launched `scanMutation.mutate(...)` from a `useEffect`. The effect set a `cancelled` ref on cleanup and the `onSuccess` callback correctly checked `if (cancelled) return;` before any state updates. The `onError` callback was missing entirely. A mutation that resolved with an error after the component unmounted still triggered downstream state updates on the unmounted screen.

## Symptoms

- React warning about state update on unmounted component, but only on the error path
- The success path looks safe; only the network-error path leaks
- Bug is invisible in normal QA — only surfaces when the user navigates away during a failed mutation

## Root Cause

Asymmetric guard placement. When a `useEffect` calls `mutation.mutate({ onSuccess, onError })` with an unmount-guard pattern, the guard must apply to every callback that touches state. Adding a guard to `onSuccess` and omitting `onError` (or relying on the default no-op `onError`) leaves the error path unprotected. The cleanup ref flips on unmount but only the success path checks it.

## Solution

Provide an explicit `onError` and check the same `cancelled` ref:

```typescript
useEffect(
  () => {
    let cancelled = false;
    scanMutation.mutate(payload, {
      onSuccess: (data) => {
        if (cancelled) return;
        setResult(data);
      },
      onError: () => {
        if (cancelled) return;
        setError("Scan failed");
      },
    });
    return () => {
      cancelled = true;
    };
  },
  [
    /* deps */
  ],
);
```

## Prevention

- Whenever a `useEffect` callback launches `mutation.mutate({ onSuccess, onError })`, both callbacks must check the `cancelled` ref. A guard on only one path leaves the other unprotected.
- If you do not need a custom `onError`, still write one whose body is `if (cancelled) return;` — explicit no-state-update on unmount.
- Lint rule potential: flag any `mutation.mutate` inside `useEffect` whose options object omits `onError` when `onSuccess` references state setters.

## Related Files

- `client/screens/ReceiptReviewScreen.tsx` — added `onError` with cancelled guard

## See Also

- [Async operation timeout / fallback race guard](../design-patterns/async-operation-timeout-fallback-race-guard-2026-05-13.md)
