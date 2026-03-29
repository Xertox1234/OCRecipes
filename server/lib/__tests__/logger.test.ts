import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";

describe("logger + AsyncLocalStorage integration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("getRequestContext returns undefined outside a request", async () => {
    const { getRequestContext } = await import("../request-context");
    expect(getRequestContext()).toBeUndefined();
  });

  it("ALS context propagates through promise chains (fireAndForget pattern)", async () => {
    const als = new AsyncLocalStorage<{ requestId: string }>();
    const captured: string[] = [];

    const ctx = { requestId: "req-abc-123" };

    await als.run(ctx, async () => {
      const promise = new Promise<void>((resolve) => {
        setTimeout(() => {
          const store = als.getStore();
          if (store) captured.push(store.requestId);
          resolve();
        }, 10);
      });

      promise.catch(() => {
        const store = als.getStore();
        if (store) captured.push(store.requestId);
      });

      await promise;
    });

    expect(captured).toEqual(["req-abc-123"]);
  });

  it("setRequestUserId updates the context in-place", async () => {
    const { requestContextMiddleware, getRequestContext, setRequestUserId } =
      await import("../request-context");

    const req = { id: "test-uuid-from-pino-http" } as any;
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
    expect(contextInsideMiddleware?.requestId).toBe("test-uuid-from-pino-http");
    expect(setHeaderCalls).toContainEqual([
      "X-Request-Id",
      "test-uuid-from-pino-http",
    ]);
  });

  it("requestContextMiddleware reads req.id set by pino-http", async () => {
    const { requestContextMiddleware, getRequestContext } = await import(
      "../request-context"
    );

    const pinoGeneratedId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const req = { id: pinoGeneratedId } as any;
    const res = { setHeader: vi.fn() } as any;

    let capturedRequestId: string | undefined;

    requestContextMiddleware(req, res, () => {
      capturedRequestId = getRequestContext()?.requestId;
    });

    // ALS should use the same ID that pino-http generated
    expect(capturedRequestId).toBe(pinoGeneratedId);
    // Response header should also match
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", pinoGeneratedId);
  });

  it("toError wraps non-Error values into Error instances", async () => {
    const { toError } = await import("../logger");

    const realError = new Error("real");
    expect(toError(realError)).toBe(realError);

    expect(toError("string error")).toBeInstanceOf(Error);
    expect(toError("string error").message).toBe("string error");

    expect(toError(42)).toBeInstanceOf(Error);
    expect(toError(null)).toBeInstanceOf(Error);
    expect(toError(undefined)).toBeInstanceOf(Error);
  });
});
