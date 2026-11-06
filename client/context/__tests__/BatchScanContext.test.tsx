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
  const mockApiRequest = vi.fn(
    (_method: string, url: string) =>
      new Promise((resolve) => {
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
});
