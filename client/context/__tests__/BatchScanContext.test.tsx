// @vitest-environment jsdom
import React from "react";
import { act, renderHook } from "@testing-library/react";

import { BatchScanProvider, useBatchScan } from "../BatchScanContext";

type Deferred = {
  url: string;
  resolve: (body: Record<string, unknown>) => void;
};

const { mockApiRequest, pending } = vi.hoisted(() => {
  const pending: Deferred[] = [];
  // Honours init.signal the way fetch does: an abort rejects the request.
  const mockApiRequest = vi.fn(
    (_method: string, url: string, _data?: unknown, init?: RequestInit) =>
      new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
        pending.push({
          url,
          resolve: (body) => resolve({ json: async () => body }),
        });
      }),
  );
  return { mockApiRequest, pending };
});

vi.mock("@/lib/query-client", () => ({ apiRequest: mockApiRequest }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

function renderBatchScan() {
  return renderHook(() => useBatchScan(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <BatchScanProvider>{children}</BatchScanProvider>
    ),
  });
}

const flush = () => act(async () => {});

describe("BatchScanContext lookup queue", () => {
  beforeEach(() => {
    mockApiRequest.mockClear();
    pending.length = 0;
  });

  it("runs at most 3 lookups at once and drains the queue as each one settles", async () => {
    const { result } = renderBatchScan();

    act(() => {
      result.current.startSession();
      for (const code of ["111", "222", "333", "444", "555"]) {
        result.current.addItemAndLookup(code);
      }
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(3);
    expect(result.current.pendingCount).toBe(5);

    pending[0].resolve({ productName: "First", calories: 100 });
    await flush();

    expect(mockApiRequest).toHaveBeenCalledTimes(4);
    expect(pending[3].url).toBe("/api/nutrition/barcode/444");
    expect(result.current.pendingCount).toBe(4);
    expect(result.current.getItems()[0]).toMatchObject({
      barcode: "111",
      status: "resolved",
      productName: "First",
      calories: 100,
    });

    pending[1].resolve({ productName: "Second" });
    await flush();

    expect(mockApiRequest).toHaveBeenCalledTimes(5);
    expect(pending[4].url).toBe("/api/nutrition/barcode/555");
  });

  // Camera audit 2026-11-21 L3: clearSession zeroed the in-flight counter, then
  // each aborted lookup's finally decremented it again (down to -3), so the
  // next session ran up to 6 lookups at once.
  it("keeps the 3-lookup cap after a session with pending lookups is cleared", async () => {
    const { result } = renderBatchScan();

    act(() => {
      result.current.startSession();
      for (const code of ["111", "222", "333"]) {
        result.current.addItemAndLookup(code);
      }
    });
    act(() => {
      result.current.clearSession();
    });
    await flush();

    // No startSession here: it also cancels, and must not be what keeps the
    // counter honest.
    mockApiRequest.mockClear();
    act(() => {
      for (const code of ["444", "555", "666", "777", "888"]) {
        result.current.addItemAndLookup(code);
      }
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(3);
  });

  it("cancels the network request when the session is cleared", () => {
    const { result } = renderBatchScan();

    act(() => {
      result.current.startSession();
      result.current.addItemAndLookup("111");
    });
    const init = mockApiRequest.mock.calls[0][3] as RequestInit | undefined;
    expect(init?.signal?.aborted).toBe(false);

    act(() => {
      result.current.clearSession();
    });

    expect(init?.signal?.aborted).toBe(true);
  });

  it("a new session cancels the previous session's lookups", async () => {
    const { result } = renderBatchScan();

    act(() => {
      result.current.startSession();
      result.current.addItemAndLookup("111");
    });
    const oldInit = mockApiRequest.mock.calls[0][3] as RequestInit | undefined;

    act(() => {
      result.current.startSession();
      result.current.addItemAndLookup("222");
    });
    await flush();

    expect(oldInit?.signal?.aborted).toBe(true);
    expect(result.current.pendingCount).toBe(1);
  });

  // Passing our own signal turns off apiRequest's default 60 s deadline, so
  // the lookup owns one: a hung request must fail the item (retryable) and
  // free its slot, not sit pending forever.
  it("fails a lookup that never settles once its deadline passes", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderBatchScan();
      act(() => {
        result.current.startSession();
        result.current.addItemAndLookup("111");
      });
      expect(result.current.pendingCount).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(result.current.pendingCount).toBe(0);
      expect(result.current.getItems()[0]).toMatchObject({
        barcode: "111",
        status: "error",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
