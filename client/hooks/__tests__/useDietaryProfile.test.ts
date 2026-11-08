// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { dietaryProfileQueryOptions } from "../useDietaryProfile";
import { QUERY_KEYS } from "@/lib/query-keys";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("dietaryProfileQueryOptions", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("is keyed by QUERY_KEYS.dietaryProfile, the one key every reader shares", () => {
    expect(dietaryProfileQueryOptions.queryKey).toEqual(
      QUERY_KEYS.dietaryProfile,
    );
  });

  it("GETs the profile, passing the server's null (no profile row yet) through", async () => {
    mockApiRequest.mockResolvedValue({ json: async () => null });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useQuery(dietaryProfileQueryOptions), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/user/dietary-profile",
      undefined,
      { signal: expect.any(AbortSignal) },
    );
    expect(result.current.data).toBeNull();
  });

  it("lets a reader narrow the shared entry with its own select", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ dietType: "vegan", reminderMutes: { meals: true } }),
    });
    const { wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () =>
        useQuery({
          ...dietaryProfileQueryOptions,
          select: (profile) => profile?.dietType ?? null,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe("vegan");
  });
});
