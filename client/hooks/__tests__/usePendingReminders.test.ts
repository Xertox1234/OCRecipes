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

vi.mock("react-native", () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

describe("usePendingReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
});
