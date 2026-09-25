import { ApiError } from "../api-error";
import {
  shouldSurfaceQueryError,
  shouldSurfaceMutationError,
  subscribeToQueryErrors,
  queryClient,
} from "../query-client";

describe("shouldSurfaceQueryError", () => {
  it("surfaces a generic/transient error (no meta)", () => {
    expect(
      shouldSurfaceQueryError(new Error("Network request failed"), undefined),
    ).toBe(true);
  });

  it("surfaces 5xx server errors", () => {
    expect(
      shouldSurfaceQueryError(
        new ApiError("500: Internal Server Error"),
        undefined,
      ),
    ).toBe(true);
    expect(
      shouldSurfaceQueryError(
        new ApiError("503: Service Unavailable"),
        undefined,
      ),
    ).toBe(true);
  });

  it("suppresses 4xx client errors (screens already branch on these)", () => {
    expect(
      shouldSurfaceQueryError(new ApiError("400: Bad Request"), undefined),
    ).toBe(false);
    expect(
      shouldSurfaceQueryError(new ApiError("404: Not Found"), undefined),
    ).toBe(false);
    expect(
      shouldSurfaceQueryError(
        new ApiError('403: {"code":"PREMIUM_REQUIRED"}', "PREMIUM_REQUIRED"),
        undefined,
      ),
    ).toBe(false);
  });

  it("suppresses the 401 auth-redirect path (covered by the 4xx guard)", () => {
    expect(
      shouldSurfaceQueryError(new ApiError("401: Unauthorized"), undefined),
    ).toBe(false);
  });

  it("suppresses when meta.silentError is true (screen renders its own error UI)", () => {
    expect(
      shouldSurfaceQueryError(new Error("Network request failed"), {
        silentError: true,
      }),
    ).toBe(false);
    // silentError wins even over an error that would otherwise be surfaced (5xx)
    expect(
      shouldSurfaceQueryError(new ApiError("500: boom"), { silentError: true }),
    ).toBe(false);
  });

  it("surfaces when meta is present but silentError is not set", () => {
    expect(
      shouldSurfaceQueryError(new Error("Network request failed"), {
        someOtherFlag: 1,
      }),
    ).toBe(true);
  });

  it("treats non-Error throwables as surfaceable (no 4xx message to inspect)", () => {
    expect(shouldSurfaceQueryError("string failure", undefined)).toBe(true);
    expect(shouldSurfaceQueryError(undefined, undefined)).toBe(true);
  });
});

describe("shouldSurfaceMutationError", () => {
  it("surfaces a generic/transient error (no meta)", () => {
    expect(
      shouldSurfaceMutationError(
        new Error("Network request failed"),
        undefined,
      ),
    ).toBe(true);
  });

  it("surfaces 5xx server errors", () => {
    expect(
      shouldSurfaceMutationError(
        new ApiError("500: Internal Server Error"),
        undefined,
      ),
    ).toBe(true);
  });

  it("suppresses 4xx client errors (call sites already branch on a specific code)", () => {
    expect(
      shouldSurfaceMutationError(new ApiError("400: Bad Request"), undefined),
    ).toBe(false);
    expect(
      shouldSurfaceMutationError(
        new ApiError('403: {"code":"LIMIT_REACHED"}', "LIMIT_REACHED"),
        undefined,
      ),
    ).toBe(false);
    expect(
      shouldSurfaceMutationError(
        new ApiError("409: Conflict", "CONFLICT"),
        undefined,
      ),
    ).toBe(false);
  });

  it("suppresses when meta.silentError is true (call site renders its own error UI)", () => {
    expect(
      shouldSurfaceMutationError(new Error("Network request failed"), {
        silentError: true,
      }),
    ).toBe(false);
    expect(
      shouldSurfaceMutationError(new ApiError("500: boom"), {
        silentError: true,
      }),
    ).toBe(false);
  });

  it("surfaces when meta is present but silentError is not set", () => {
    expect(
      shouldSurfaceMutationError(new Error("Network request failed"), {
        someOtherFlag: true,
      }),
    ).toBe(true);
  });

  it("treats non-Error throwables as surfaceable (no 4xx message to inspect)", () => {
    expect(shouldSurfaceMutationError("string failure", undefined)).toBe(true);
    expect(shouldSurfaceMutationError(undefined, undefined)).toBe(true);
  });
});

describe("subscribeToQueryErrors", () => {
  it("removes the listener when the returned unsubscribe fn is called (idempotent)", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    unsubscribe();
    // Calling unsubscribe again must not throw.
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe("global query error net (QueryCache.onError → emitter)", () => {
  // Drives the real `queryClient` so the cache-level onError, the
  // shouldSurfaceQueryError filter, and the module-level emitter are exercised
  // together. fetchQuery rejects when the queryFn throws; we assert the
  // listener fired (or was suppressed) as a side effect.
  async function runFailingQuery(opts: {
    queryKey: unknown[];
    error: unknown;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await queryClient.fetchQuery({
        queryKey: opts.queryKey,
        queryFn: async () => {
          throw opts.error;
        },
        retry: false,
        meta: opts.meta,
      });
    } catch {
      // Expected — the query rejects.
    }
  }

  it("emits a message to subscribers when a query fails with a 5xx", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingQuery({
      queryKey: ["__test__/global-net/5xx"],
      error: new ApiError("500: Internal Server Error"),
    });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(expect.any(String));
  });

  it("does NOT emit for 4xx client errors", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingQuery({
      queryKey: ["__test__/global-net/4xx"],
      error: new ApiError("404: Not Found"),
    });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does NOT emit when the query opts out via meta.silentError", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingQuery({
      queryKey: ["__test__/global-net/silent"],
      error: new ApiError("500: Internal Server Error"),
      meta: { silentError: true },
    });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does NOT emit to a listener that has unsubscribed", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    unsubscribe();
    await runFailingQuery({
      queryKey: ["__test__/global-net/unsubscribed"],
      error: new ApiError("500: Internal Server Error"),
    });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("global mutation error net (MutationCache.onError → emitter)", () => {
  // Drives the real `queryClient`'s mutation cache directly (there is no
  // fetchQuery-style convenience for mutations) so the cache-level onError,
  // the shouldSurfaceMutationError filter, and the shared emitter are
  // exercised together, the same way the query-side block above does.
  async function runFailingMutation(opts: {
    error: unknown;
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => {
        throw opts.error;
      },
      meta: opts.meta,
    });
    try {
      await mutation.execute(undefined);
    } catch {
      // Expected — the mutation rejects.
    }
  }

  it("emits a message to subscribers when a mutation fails with a 5xx", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingMutation({
      error: new ApiError("500: Internal Server Error"),
    });
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toEqual(expect.any(String));
  });

  it("does NOT emit for 4xx client errors", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingMutation({
      error: new ApiError("409: Conflict", "CONFLICT"),
    });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does NOT emit when the mutation opts out via meta.silentError", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    await runFailingMutation({
      error: new ApiError("500: Internal Server Error"),
      meta: { silentError: true },
    });
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("does NOT emit to a listener that has unsubscribed", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToQueryErrors(listener);
    unsubscribe();
    await runFailingMutation({
      error: new ApiError("500: Internal Server Error"),
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
