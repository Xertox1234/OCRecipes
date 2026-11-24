// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { useWriteCard } from "../useWriteCard";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useWriteCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a save refreshes the queries for the card's kind", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ receipt: "✓ saved" }),
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useWriteCard("card-1", "pantry"), {
      wrapper,
    });

    await act(async () => {
      await result.current.save({});
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/pantry"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/pantry/expiring"],
    });
  });

  it("an undo refreshes them too", async () => {
    const { wrapper, queryClient } = createQueryWrapper();
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ status: "live" }),
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useWriteCard("card-1", "grocery"), {
      wrapper,
    });

    await act(async () => {
      await result.current.undo();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/meal-plan/grocery-lists"],
    });
  });
});
