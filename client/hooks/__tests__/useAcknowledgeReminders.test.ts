// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAcknowledgeReminders } from "../useAcknowledgeReminders";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useAcknowledgeReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls POST /api/reminders/acknowledge and returns coachContext", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () =>
        Promise.resolve({
          acknowledged: 1,
          coachContext: [{ type: "daily-checkin", calories: 1200 }],
        }),
    });

    const { result } = renderHook(() => useAcknowledgeReminders(), { wrapper });

    await act(async () => {
      await result.current.acknowledge();
    });

    await waitFor(() =>
      expect(result.current.coachContext).toEqual([
        { type: "daily-checkin", calories: 1200 },
      ]),
    );

    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/reminders/acknowledge",
    );
  });

  it("coachContext starts as an empty array", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAcknowledgeReminders(), { wrapper });

    expect(result.current.coachContext).toEqual([]);
  });

  it("exposes isPending/isError/error so a failed acknowledge is surfaceable", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValue(new Error("500: server error"));

    const { result } = renderHook(() => useAcknowledgeReminders(), { wrapper });

    expect(result.current.isPending).toBe(false);

    await act(async () => {
      await expect(result.current.acknowledge()).rejects.toThrow(
        "500: server error",
      );
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isPending).toBe(false);
  });
});
