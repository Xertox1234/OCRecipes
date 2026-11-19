import { fetchWithTimeout } from "../fetch-timeout";

// R16 / N3: React Native's fetch has no default timeout (Android has no read
// timeout at all), so a hung connection never settles. fetchWithTimeout aborts
// after a deadline and also honours a caller/TanStack cancellation signal.
//
// Reliability audit 2026-11-19 M-obs-1: the global fetch on a device is
// expo/fetch, which rejects an abort before headers as a plain `Error`
// ("fetch failed: Fetch request has been canceled", name "Error"), while Node /
// whatwg fetch rejects with name "AbortError". fetchWithTimeout must name the
// outcome itself, whichever shape fetch uses: "TimeoutError" when its own
// deadline fired, "AbortError" when the caller cancelled.
const REJECTION_SHAPES = {
  "Node/whatwg fetch (AbortError)": () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
  },
  "expo/fetch (plain Error)": () =>
    new Error("fetch failed: Fetch request has been canceled"),
} as const;

describe.each(Object.entries(REJECTION_SHAPES))(
  "fetchWithTimeout when fetch rejects like %s",
  (_label, makeAbortRejection) => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      // A fetch that never settles unless its signal aborts — a hung connection.
      fetchMock = vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            // Real fetch rejects immediately on an already-aborted signal.
            if (init?.signal?.aborted) return reject(makeAbortRejection());
            init?.signal?.addEventListener("abort", () =>
              reject(makeAbortRejection()),
            );
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it("rejects with a TimeoutError once the deadline passes", async () => {
      const p = fetchWithTimeout("https://x.test/a", {}, 5_000);
      const settled = expect(p).rejects.toMatchObject({ name: "TimeoutError" });
      await vi.advanceTimersByTimeAsync(5_000);
      await settled;
    });

    it("does not abort before the deadline", async () => {
      const p = fetchWithTimeout("https://x.test/a", {}, 5_000);
      let settled = false;
      p.catch(() => {}).finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(4_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
    });

    it("rejects with an AbortError when the caller's signal aborts (TanStack query cancellation)", async () => {
      const caller = new AbortController();
      const p = fetchWithTimeout(
        "https://x.test/a",
        { signal: caller.signal },
        60_000,
      );
      const settled = expect(p).rejects.toMatchObject({ name: "AbortError" });
      caller.abort();
      await settled;
    });

    it("rejects with an AbortError at once when the caller's signal is already aborted", async () => {
      const caller = new AbortController();
      caller.abort();
      const p = fetchWithTimeout(
        "https://x.test/a",
        { signal: caller.signal },
        60_000,
      );
      await expect(p).rejects.toMatchObject({ name: "AbortError" });
    });
  },
);

describe("fetchWithTimeout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("passes a failure that is not an abort through unchanged", async () => {
    const network = new TypeError("Network request failed");
    fetchMock.mockRejectedValueOnce(network);
    await expect(fetchWithTimeout("https://x.test/a", {}, 5_000)).rejects.toBe(
      network,
    );
  });

  it("clears the deadline timer once the request settles", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://x.test/a", {}, 5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("passes the rest of init through to fetch", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout(
      "https://x.test/a",
      { method: "POST", headers: { A: "1" } },
      5_000,
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ A: "1" });
    expect(init.signal).toBeDefined();
  });
});
