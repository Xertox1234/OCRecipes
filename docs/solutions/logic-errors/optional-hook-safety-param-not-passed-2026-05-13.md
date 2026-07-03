---
title: Optional Hook Safety Param Silently Dropped at Call Site
track: bug
category: logic-errors
module: client
severity: high
tags: [hooks, safety-guard, typescript-optional, code-review, scan]
symptoms: [Hook declares an optional safety parameter (e.g. `isFocused`) but the call site never passes it, Inner guard logic that depends on the parameter never fires — guard is permanently disabled, TypeScript reports no error and the call site looks correct]
applies_to: [client/screens/ScanScreen.tsx, client/camera/hooks/useScanClassification.ts]
created: '2026-04-28'
---

# Optional Hook Safety Param Silently Dropped at Call Site

## Problem

`useScanClassification` accepted an optional `isFocused` parameter that guards against processing frames when the screen is not focused (stale navigation guard). `ScanScreen.tsx` declared `isFocused` via `useIsFocused()` and used it correctly on `<CameraView isActive={isFocused} />`, but never threaded it into `useScanClassification(...)`. The internal focus guard inside the hook was permanently disabled.

## Symptoms

- The hook's safety guard never short-circuits — stale navigation events continue to mutate state after the screen blurs
- Code review sees the parameter declared and used elsewhere on the page; the omission at one call site is invisible
- TypeScript does not warn about a missing optional parameter

## Root Cause

TypeScript treats optional parameters as `T | undefined`. Omitting the argument is legal — there is no diagnostic, no lint rule, no warning. When the omitted parameter controls a safety guard, the guard silently degrades to a permanent no-op. Review by reading the call site looks correct because the local variable exists and is used elsewhere; the bug is in what is **not** there.

## Solution

Pass the parameter explicitly. Then, when introducing a hook with an optional safety-related parameter, grep every call site to confirm it is actually connected:

```typescript
// Wire isFocused through to the hook that depends on it
const isFocused = useIsFocused();
useScanClassification({ isFocused /* was: missing */ });
```

## Prevention

- When a hook has an optional safety-related parameter (focus guard, abort signal, cancellation token, etc.), grep every call site after adding the parameter to confirm it is connected. A declared-but-not-passed param silently disables the safety guard with zero TypeScript signal.
- Consider making such parameters required when they materially affect correctness. Required parameters fail loudly at every call site.
- Audit checklist: search by hook name across the repo and inspect each invocation's argument shape.

## Related Files

- `client/camera/hooks/useScanClassification.ts` — `isFocused` parameter and L20 guard
- `client/screens/ScanScreen.tsx` — call site that now passes `isFocused`

## See Also

- [Wire optional defense-in-depth parameters](../conventions/wire-optional-defense-in-depth-parameters-2026-05-13.md)
- [Camera `isActive` must include overlay state](../conventions/camera-isactive-include-overlay-state-2026-05-13.md)
