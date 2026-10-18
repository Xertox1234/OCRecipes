---
title: "React Compiler bails on a try/catch/finally inside a hook's callback — move the async body to a module-level runner that takes a deps object"
track: bug
category: code-quality
tags: [react-native, hooks, performance, typescript]
module: client
applies_to: ["client/hooks/**/*.ts", "client/components/**/*.tsx", "client/screens/**/*.tsx"]
symptoms: ["`node scripts/check-react-compiler-bailouts.js` (CI's Lint · Types · Patterns job) reports 1 new bailout for a hook whose `useCallback` wraps an async IIFE with try/catch/finally", "Vitest, tsc and ESLint are all green; only the ratchet notices"]
created: 2026-10-18
severity: medium
---

# React Compiler bails on a try/catch/finally inside a hook's callback — move the async body to a module-level runner

## Problem

`useGenerateRecipeInBackground` (#1494) put the whole request inside its `useCallback`:

```ts
const start = useCallback((input) => {
  setPendingGeneration(queryClient, "photo", true);
  void (async () => {
    try { … await apiRequest(…) … } catch (err) { … } finally {
      setPendingGeneration(queryClient, "photo", false);
    }
  })();
}, [queryClient, toast, haptics]);
```

Local tests, lint and types passed. CI failed on the bailout ratchet: **1 new bailout**, the hook itself.

## Root Cause

React Compiler cannot lower a `finally` (the known limit named in [react-compiler-memoization-audits](../best-practices/react-compiler-memoization-audits-2026-06-10.md)) and skips the whole compiled unit — here the hook, so every component that calls it loses the compiler's memoization for that hook's returns. The `try` lives inside the hook because the pending flag must be released on every path, and a hook body is the natural place for it; nothing in the editor says the construct is off-limits.

## Solution

Keep the hook thin and move the async body — with its try/catch/finally — into a **module-level function the compiler never sees**, handing it the hook-scoped values as one deps object:

```ts
interface GenerationDeps {
  queryClient: QueryClient;
  toast: Pick<ReturnType<typeof useToast>, "error">;
  haptics: Pick<ReturnType<typeof useHaptics>, "notification">;
}

export async function runPhotoGeneration(
  { queryClient, toast, haptics }: GenerationDeps,
  input: GenerateRecipeInput,
): Promise<void> {
  try { … } catch (err) { … } finally { setPendingGeneration(queryClient, "photo", false); }
}

export function useGenerateRecipeInBackground() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const haptics = useHaptics();
  const start = useCallback((input) => {
    if (isPendingGeneration(queryClient, "photo")) return;
    setPendingGeneration(queryClient, "photo", true);
    void runPhotoGeneration({ queryClient, toast, haptics }, input);
  }, [queryClient, toast, haptics]);
  return { start };
}
```

Behaviour is identical (the closure still outlives the component), the runner is directly testable, and the ratchet went from 1 new bailout to 0 (#1494 `689b31fa`). The second hook of the same project (`useRecipeGenerate`, #1495) was written in this shape from the start and never tripped the ratchet.

`Pick<ReturnType<typeof useToast>, "error">` keeps the deps object honest without a cast and lets tests pass a two-key stub.

## Prevention

- A hook that owns an async flow with cleanup (`finally`) is the signal: write the flow as `run<Thing>(deps, args)` at module level and let the hook only gate and dispatch.
- Run `node scripts/check-react-compiler-bailouts.js` before pushing any hook with a `try` — it takes ~1 min and is the only local signal; CI's lint job runs the same script.
- The sibling rule for a ternary / `&&` / `?.` inside a `try` is [react-compiler-bails-on-a-conditional-inside-a-try](./react-compiler-bails-on-a-conditional-inside-a-try-2026-10-10.md); compute the condition before the `try` when the `try` has to stay in the component.

## Related Files

- `client/hooks/useGenerateRecipeInBackground.ts` (`runPhotoGeneration`), `client/hooks/useRecipeGenerate.ts` (`runDraftGeneration`)
- `scripts/check-react-compiler-bailouts.js`, `scripts/react-compiler-bailout-baseline.json`

## See Also

- [React Compiler memoization audits](../best-practices/react-compiler-memoization-audits-2026-06-10.md) — coverage is per file; `try`/`finally` is in its bailout list
- [React Compiler discards an unread useMemo dependency](../conventions/react-compiler-discards-unread-usememo-dependency-2026-09-02.md)
