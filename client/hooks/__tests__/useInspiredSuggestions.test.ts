// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";

import {
  useCreateSuggestionListing,
  useMakeSuggestion,
} from "../useInspiredSuggestions";

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock("@/lib/query-client", async (orig) => ({
  ...(await orig<object>()),
  apiRequest,
}));

const card = {
  id: 1,
  title: "Bean Tacos",
  description: "Quick bright tacos tonight.",
  totalMinutes: 25,
  tags: [],
  imageUrl: null,
  madeRecipeId: null,
};
const json = (body: unknown) => ({ json: async () => body }) as Response;

beforeEach(() => apiRequest.mockReset());

describe("useCreateSuggestionListing", () => {
  it("POSTs the query and returns parsed suggestions", async () => {
    apiRequest.mockResolvedValue(json({ suggestions: [card] }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCreateSuggestionListing(), {
      wrapper,
    });
    let out: unknown;
    await act(async () => {
      out = await result.current.mutateAsync({ query: "tacos" });
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/inspired/suggestions",
      { query: "tacos" },
    );
    expect(out).toEqual([card]);
  });
});

describe("useMakeSuggestion", () => {
  it("POSTs make and returns the recipe id", async () => {
    apiRequest.mockResolvedValue(json({ recipeId: 88 }));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMakeSuggestion(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync(1);
    });
    expect(apiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/inspired/suggestions/1/make",
    );
    await waitFor(() => expect(result.current.data).toEqual({ recipeId: 88 }));
  });
});
