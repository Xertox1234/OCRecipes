// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { usePendingReminders } from "../usePendingReminders";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

// AppState is provided as a vi.fn()-based mock by test/mocks/react-native.ts —
// no inline RN re-mock needed. vi.clearAllMocks() in test/setup.ts clears call
// history between tests, so the AppState.addEventListener spy stays usable.

describe("usePendingReminders", () => {
  it("returns hasPending: true when the API reports pending reminders", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ hasPending: true }),
    });

    const { result } = renderHook(() => usePendingReminders(), { wrapper });

    await waitFor(() => expect(result.current.hasPending).toBe(true));
  });

  it("returns hasPending: false when no reminders pending", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ hasPending: false }),
    });

    const { result } = renderHook(() => usePendingReminders(), { wrapper });

    await waitFor(() => expect(result.current.hasPending).toBe(false));
  });

  it("defaults to false before the query resolves", () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => usePendingReminders(), { wrapper });

    expect(result.current.hasPending).toBe(false);
  });

  it("exposes isError/error so a failed pending-reminders read is distinguishable from 'no pending'", async () => {
    const { wrapper } = createQueryWrapper();
    mockApiRequest.mockRejectedValue(new Error("500: server error"));

    const { result } = renderHook(() => usePendingReminders(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.hasPending).toBe(false);
  });
});
