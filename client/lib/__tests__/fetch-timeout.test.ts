import { fetchWithTimeout } from "../fetch-timeout";

// R16 / N3: React Native's fetch has no default timeout (Android has no read
// timeout at all), so a hung connection never settles. fetchWithTimeout aborts
// after a deadline and also honours a caller/TanStack cancellation signal.
describe("fetchWithTimeout", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // A fetch that never settles unless its signal aborts — a hung connection.
    fetchMock = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const abortErr = () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            return err;
          };
          // Real fetch rejects immediately on an already-aborted signal.
          if (init?.signal?.aborted) return reject(abortErr());
          init?.signal?.addEventListener("abort", () => reject(abortErr()));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a hung request once the deadline passes", async () => {
    const p = fetchWithTimeout("https://x.test/a", {}, 5_000);
    const settled = expect(p).rejects.toMatchObject({ name: "AbortError" });
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

  it("aborts when the caller's signal aborts (TanStack query cancellation)", async () => {
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

  it("aborts immediately when the caller's signal is already aborted", async () => {
    const caller = new AbortController();
    caller.abort();
    const p = fetchWithTimeout(
      "https://x.test/a",
      { signal: caller.signal },
      60_000,
    );
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
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
