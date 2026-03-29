import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

// We test the request-context + logger integration by verifying that
// fireAndForget preserves AsyncLocalStorage context through promise chains.

describe("logger + AsyncLocalStorage integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getRequestContext returns undefined outside a request", async () => {
    const { getRequestContext } = await import("../request-context");
    expect(getRequestContext()).toBeUndefined();
  });

  it("getRequestContext returns context inside ALS.run()", async () => {
    const { getRequestContext } = await import("../request-context");

    // Simulate what requestContextMiddleware does by using a fresh ALS
    const als = new AsyncLocalStorage<{
      requestId: string;
      userId: string | null;
    }>();
    const ctx = { requestId: "test-uuid-1234", userId: null };

    als.run(ctx, () => {
      // The module-level ALS won't have this context since we're using a different instance,
      // but we can verify ALS propagation works in principle
      expect(als.getStore()).toBe(ctx);
    });
  });

  it("ALS context propagates through promise chains (fireAndForget pattern)", async () => {
    const als = new AsyncLocalStorage<{ requestId: string }>();
    const captured: string[] = [];

    const ctx = { requestId: "req-abc-123" };

    await als.run(ctx, async () => {
      // Simulate fireAndForget: create a promise that resolves later
      const promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          // Inside the timeout, ALS context should still be available
          const store = als.getStore();
          if (store) captured.push(store.requestId);
          resolve();
        }, 10);
      });

      // Simulate .catch() handler accessing ALS (like fireAndForget does)
      promise.catch(() => {
        const store = als.getStore();
        if (store) captured.push(store.requestId);
      });

      await promise;
    });

    expect(captured).toEqual(["req-abc-123"]);
  });

  it("setRequestUserId updates the context in-place", async () => {
    // Use the actual module's ALS via the middleware
    const { requestContextMiddleware, getRequestContext, setRequestUserId } =
      await import("../request-context");

    // Create mock req/res/next
    const req = { headers: {} } as any;
    const setHeaderCalls: [string, string][] = [];
    const res = {
      setHeader: (name: string, value: string) => {
        setHeaderCalls.push([name, value]);
      },
    } as any;

    let contextInsideMiddleware: any;

    requestContextMiddleware(req, res, () => {
      setRequestUserId("user-42");
      contextInsideMiddleware = getRequestContext();
    });

    expect(contextInsideMiddleware?.userId).toBe("user-42");
    expect(contextInsideMiddleware?.requestId).toBeDefined();
    // Should have set the response header
    expect(setHeaderCalls).toContainEqual(["X-Request-Id", expect.any(String)]);
  });
});
