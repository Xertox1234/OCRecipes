// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { useCoachBrief } from "../useCoachBrief";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@/lib/timezone", () => ({
  getDeviceTimezone: () => "America/Los_Angeles",
}));

const brief = {
  greeting: "Good afternoon.",
  recap: "Nothing logged yet today.",
  stats: [],
  pointer: null,
  reminder: null,
  suggestions: [],
  text: "Good afternoon.\n\nNothing logged yet today.",
};

describe("useCoachBrief", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches the requested form with the device timezone", async () => {
    mockApiRequest.mockResolvedValue({ json: () => Promise.resolve(brief) });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCoachBrief("short", true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.brief).toEqual(brief));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/coach/brief?form=short",
      undefined,
      { headers: { "X-Timezone": "America/Los_Angeles" } },
    );
  });

  it("does nothing while disabled", () => {
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCoachBrief("full", false), {
      wrapper,
    });
    expect(result.current.brief).toBeNull();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["a server error", "500: boom"],
    ["an older server without the endpoint", "404: Not Found"],
  ])("gives no brief on %s", async (_label, message) => {
    mockApiRequest.mockRejectedValue(new Error(message));
    const { wrapper, queryClient } = createQueryWrapper();
    const { result } = renderHook(() => useCoachBrief("full", true), {
      wrapper,
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryState([
          "/api/coach/brief",
          {
            form: "full",
            tz: "America/Los_Angeles",
          },
        ])?.status,
      ).toBe("error"),
    );
    expect(result.current.brief).toBeNull();
  });
});
