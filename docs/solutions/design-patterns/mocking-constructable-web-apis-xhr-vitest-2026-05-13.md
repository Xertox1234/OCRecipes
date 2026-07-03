---
title: Mocking constructable web APIs (XMLHttpRequest) in Vitest
track: knowledge
category: design-patterns
module: client
tags: [testing, vitest, xhr, streaming, jsdom, mocks, classes]
applies_to: [client/hooks/**/__tests__/**/*.test.ts, client/hooks/**/__tests__/**/*.test.tsx]
created: '2026-05-13'
---

# Mocking constructable web APIs (XMLHttpRequest) in Vitest

## When this applies

When testing a hook that uses `new XMLHttpRequest()`, stub the global with a **class** (not a `vi.fn()` arrow factory). Arrow functions are not constructable — `new (vi.fn(() => instance))()` throws `TypeError: ... is not a constructor`. A class is always constructable.

## Why

Use the constructor to self-register the instance so tests can drive the XHR after `sendMessage` (or equivalent) is called.

## Examples

```typescript
// @vitest-environment jsdom
type XHRHandler = ((ev: ProgressEvent) => unknown) | null;

let xhrInstance: MockXHR;
let xhrConstructorCalls = 0;

class MockXHR {
  open = vi.fn();
  setRequestHeader = vi.fn();
  timeout = 0;
  responseText = "";
  status = 200;
  onprogress: XHRHandler = null;
  onload: XHRHandler = null;
  onerror: XHRHandler = null;
  ontimeout: XHRHandler = null;
  onabort: XHRHandler = null;
  send = vi.fn();

  constructor() {
    xhrInstance = this; // ← self-registers so the test can drive it
    xhrConstructorCalls++;
  }

  // Helper methods for test scenarios
  simulateChunks(chunks: string[], status = 200) {
    this.status = status;
    let accumulated = "";
    for (const chunk of chunks) {
      accumulated += chunk;
      this.responseText = accumulated;
      this.onprogress?.(new ProgressEvent("progress"));
    }
    this.onload?.(new ProgressEvent("load"));
  }

  simulateErrorResponse(status: number, body: object) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.(new ProgressEvent("load"));
  }

  simulateNetworkError() {
    this.onerror?.(new ProgressEvent("error"));
  }
  simulateTimeout() {
    this.ontimeout?.(new ProgressEvent("timeout"));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  xhrConstructorCalls = 0;
  vi.stubGlobal("XMLHttpRequest", MockXHR); // ← stub with the class, not vi.fn(() => instance)
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

### Timing

The hook creates XHR after its first `await` (typically `tokenStorage.get()`). Wait two microtask ticks before driving the mock:

```typescript
it("streams SSE content", async () => {
  const { result } = renderHook(() => useSendMessage(42), { wrapper });

  await act(async () => {
    const p = result.current.sendMessage("test");
    await Promise.resolve(); // flush tokenStorage.get() microtask + XHR setup
    await Promise.resolve(); // extra safety margin
    xhrInstance.simulateChunks([
      'data: {"content":"hello"}\n',
      'data: {"done":true}\n',
    ]);
    await p;
  });

  expect(result.current.isStreaming).toBe(false);
});
```

## Key rules

1. **Class, not factory** — `vi.stubGlobal("XMLHttpRequest", MockXHR)` — the class is constructable; `vi.fn(() => xhrInstance)` is not
2. **Constructor self-registers** — `xhrInstance = this` runs when `new XMLHttpRequest()` is called inside the implementation
3. **`xhrConstructorCalls` for "no XHR" assertions** — more precise than checking `xhrInstance.send` (which may be stale from a previous test)
4. **`ProgressEvent` handlers ignore the event object** — the XHR implementation reads from `xhr` via closure, not `event.target`. Pass `new ProgressEvent("progress")` (or any truthy value) — it won't be used
5. **`simulateChunks` is cumulative** — it sets `responseText` to the running total and calls `onprogress` per chunk, matching how XHR `onprogress` actually fires

## When to use

Any Vitest test for a hook that uses `new XMLHttpRequest()` for streaming (SSE, file uploads, etc.).

## Exceptions

Tests for hooks that use `fetch` — mock `globalThis.fetch` instead via `vi.fn()`.

## Related Files

- `client/hooks/__tests__/useChat.test.ts` — `MockXHR` class with `simulateChunks`, `simulateErrorResponse`, `simulateNetworkError`, `simulateTimeout`

## See Also

- [Mocking class constructors in `vi.mock`](mocking-class-constructors-vi-mock-2026-05-13.md)
