---
title: TanStack Query onlineManager NetInfo Vitest Mock
track: knowledge
category: best-practices
module: client
severity: medium
tags: [tanstack-query, netinfo, react-native, testing, vitest, online-manager, focus-manager, app-state]
symptoms: [All queries in unrelated tests time out after importing query-client.ts, onlineManager goes offline as soon as the module is loaded in a Vitest worker, Test suites that don't touch NetInfo suddenly fail with Query is 'paused']
applies_to: [client/lib/query-client.ts, test/mocks/**/*.ts, vitest.config.ts]
created: '2026-05-31'
last_updated: '2026-05-31'
---

# TanStack Query onlineManager NetInfo Vitest Mock

## When This Applies

You are integrating `@react-native-community/netinfo` into a TanStack Query `onlineManager` in a React Native project, and you need to mock NetInfo in Vitest so that:

1. The global mock does **not** trigger the `onlineManager.setEventListener` callback automatically at import time.
2. Individual test files can still fully control NetInfo behavior (e.g., simulate offline/online transitions) without interfering with other test suites.

This best practice also applies if you directly set `onlineManager.setOnline` based on NetInfo's `state.isConnected` / `state.isInternetReachable`.

## Why

When you wire `NetInfo.addEventListener` to `onlineManager.setEventListener` at **module load** (e.g., inside `query-client.ts`), the side effect runs as soon as Vitest processes the import. If the mock for NetInfo invokes its callback synchronously (mimicking NetInfo's real immediate state delivery), `onlineManager` flips offline for the **whole worker**, pausing all queries in every test that shares that worker. This causes mass timeouts.

The root cause is a race condition: `vi.mock` (in `setup.ts`) runs **after** the module's top-level side effects, so any mock that fires the callback at registration time will corrupt state before any test can intervene.

Using a Vitest `resolve.alias` replaces the NetInfo module **before** any module evaluation, giving us full control. The alias stub must be completely inert — it must not invoke the registered callback. This lets `onlineManager` remain online by default, while per-file `vi.mock` calls can still override and exercise the callback when needed.

## Examples

### ❌ Incorrect: vi.mock in setup.ts that fires callback synchronously (causes timeouts)

```ts
// test/setup.ts
vi.mock('@react-native-community/netinfo', () => {
  const callbackRef = { current: null };
  return {
    default: {
      addEventListener: (cb: any) => {
        callbackRef.current = cb;
        // FIRING synchronously – disastrous!
        cb({ isConnected: true, isInternetReachable: true });
        return () => { callbackRef.current = null; };
      },
      fetch: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
    },
  };
});
```

Even though `vi.mock` is hoisted, in some Vitest configurations or complex module graphs the side effect in `query-client.ts` may execute before the mock is applied. More importantly, the synchronous `cb(...)` call immediately sets `onlineManager` to online (or offline if the stub returns `false`), corrupting the global state. 🚫

### ✅ Correct: Vitest resolve.alias with a no-op stub

**vitest.config.ts**
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Replace the real NetInfo module with a stub that never fires callbacks.
      '@react-native-community/netinfo': path.resolve(__dirname, 'test/mocks/react-native-community-netinfo.ts'),
    },
  },
  // ... rest of config
});
```

**test/mocks/react-native-community-netinfo.ts**
```ts
import { vi } from 'vitest';

// A completely inert stub. addEventListener records the callback but never invokes it.
const netInfoStub = {
  addEventListener: vi.fn().mockImplementation((_callback: (state: any) => void) => {
    // Return a no-op unsubscribe function. Do NOT call the callback.
    return () => {};
  }),
  fetch: vi.fn().mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  }),
};

export default netInfoStub;
```

Now all tests start with `onlineManager` in its default online state. No side effects.

### ✅ Per-file overrides (when a test needs NetInfo control)

```ts
// my-test.spec.ts
import { vi } from 'vitest';
import NetInfo from '@react-native-community/netinfo';

// Override the stub for this file only.
vi.mock('@react-native-community/netinfo', () => ({
  default: {
    addEventListener: vi.fn((cb) => {
      // Store callback for later use
      (globalThis as any).__netInfoCallback = cb;
      return () => {};
    }),
    fetch: vi.fn(),
  },
}));

// In test body:
await import('../lib/query-client'); // triggers setEventListener

const callback = (globalThis as any).__netInfoCallback;
callback({ isConnected: false, isInternetReachable: false });
// onlineManager is now offline
```

Because `vi.mock` is hoisted above imports, it takes precedence over the alias-resolved stub for this file.

### ✅ Null-safe setOnline pattern

When wiring NetInfo state to `onlineManager.setOnline`, use the following conditional to avoid marking queries offline when NetInfo returns `null` on cold start:

```ts
// client/lib/query-client.ts
import NetInfo from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

NetInfo.addEventListener((state) => {
  // Use !(isConnected === false || isInternetReachable === false)
  // NOT !!state.isConnected because NetInfo may return null initially.
  onlineManager.setOnline(
    !(state.isConnected === false || state.isInternetReachable === false)
  );
});
```

This mirrors the pattern from `@tanstack/react-query-native-devtools` and prevents spurious offline mode when the first state emission contains `null` values.

## focusManager Companion (foreground refetch)

Wiring `focusManager` is the React Native companion to the `onlineManager` wiring, and it lives in the same module (`client/lib/query-client.ts`). It controls TanStack Query's focus signal — the event that tells the query client to consider refetching data when the app returns to the foreground.

### The critical non-obvious gotcha

Wiring `focusManager` only controls TanStack's focus **signal**. It does **not** bypass the global `refetchOnWindowFocus: false` default. That global default still gates whether any refetch actually fires. So you can (and this project does) leave the global `refetchOnWindowFocus: false` untouched while wiring `focusManager`. Foreground refetch then becomes strictly per-query opt-in.

Before wiring `focusManager`, per-query `refetchOnWindowFocus: true` opt‑ins (e.g., `useHistoryData`, `useCoachContext`) silently never fire on native because native has no window‑focus events. Wiring `focusManager` makes those opt‑ins actually work, with zero refetch‑storm risk because the global default stays `false`.

### Canonical wiring snippet

```ts
// client/lib/query-client.ts (also)
import { focusManager } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

focusManager.setEventListener((handleFocus) => {
  const subscription = AppState.addEventListener('change', (state) => {
    if (Platform.OS !== 'web') {
      handleFocus(state === 'active');
    }
  });
  return () => subscription.remove();
});
```

The `Platform.OS !== 'web'` guard matters, but note the actual web semantics: `focusManager.setEventListener` **replaces** TanStack's built-in focus listener on every platform — it does not layer on top of the default `visibilitychange` check. With the handler gated to native, web focus detection becomes a **no-op** (the default is gone and nothing replaces it), not the preserved document-visibility default. That is acceptable when the web target isn't built and the global `refetchOnWindowFocus: false` means the only web impact is the per-query opt-ins losing focus refetch. If you want web to keep the default behavior, use the docs' `useEffect` + `focusManager.setFocused` pattern instead (which layers on top of the default) rather than `setEventListener`.

### Testing note

Unlike NetInfo (which required a `resolve.alias` inert stub because the real module is hard to mock safely at module load), the existing `test/mocks/react-native.ts` mock already handles `AppState.addEventListener` correctly — it returns `{ remove }` and never fires the callback. Therefore the module‑level `focusManager` wiring is import‑safe across all test files that import the real `query-client` module. **No new mock infrastructure is needed.**

To keep the `focusManager` logic testable, extract a pure helper:

```ts
// client/lib/app-state-helper.ts
export function appStateToFocus(state: string, os: string): boolean {
  if (os === 'web') {
    // On web, let TanStack's default handle it; return true to stay focused.
    return true;
  }
  return state === 'active';
}
```

Then unit‑test that mapping against real production code per `docs/rules/testing.md`. The wiring in `query-client.ts` becomes:

```ts
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (appState) => {
    handleFocus(appStateToFocus(appState, Platform.OS));
  });
  return () => sub.remove();
});
```

## Exceptions

- If your query-client module lazy‑loads the side effect (e.g., inside a React component's `useEffect`), the alias approach is unnecessary because the module evaluation is delayed. In that case, standard `vi.mock` in `setup.ts` may suffice.
- If you never test the offline behaviour, the alias stub alone is enough – no per-file overrides needed.

## Related Files

- `client/lib/query-client.ts` – Where `NetInfo.addEventListener` is wired to `onlineManager.setEventListener` and where `focusManager.setEventListener` is wired to `AppState.addEventListener`.
- `test/mocks/react-native-community-netinfo.ts` – The no‑op stub used by the Vitest alias.
- `test/mocks/react-native.ts` – The AppState mock that safely handles the focusManager wiring.
- `vitest.config.ts` – Contains the `resolve.alias` entry.

## See Also

- [TanStack Query onlineManager documentation](https://tanstack.com/query/latest/docs/react/reference/onlineManager)
- [TanStack Query focusManager documentation](https://tanstack.com/query/latest/docs/react/reference/focusManager)
- [Vitest resolve.alias configuration](https://vitest.dev/config/#resolve-alias)
- [@react-native-community/netinfo](https://github.com/react-native-netinfo/react-native-netinfo)
- [Dead UI branch from duplicated context types – logic error solution](../logic-errors/dead-ui-branch-from-duplicated-context-types-2026-05-16.md) (parallel example of race‑condition bugs in module load)
