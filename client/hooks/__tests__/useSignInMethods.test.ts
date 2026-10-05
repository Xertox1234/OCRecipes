// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { useSignInMethods } from "../useSignInMethods";

const { mockApiRequest } = vi.hoisted(() => ({ mockApiRequest: vi.fn() }));
vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

const methods = { password: true, google: null, apple: null };

beforeEach(() => {
  mockApiRequest.mockReset();
});

describe("useSignInMethods", () => {
  it("reads signInMethods from /api/auth/me", async () => {
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ id: "u1", signInMethods: methods }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSignInMethods(), { wrapper });
    expect(result.current.methods).toBeUndefined();
    await waitFor(() => expect(result.current.methods).toEqual(methods));
    expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/auth/me");
  });

  it("setMethods updates the cache without a refetch", async () => {
    mockApiRequest.mockResolvedValue({
      json: () => Promise.resolve({ id: "u1", signInMethods: methods }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useSignInMethods(), { wrapper });
    await waitFor(() => expect(result.current.methods).toEqual(methods));
    const next = { ...methods, apple: { email: null, isPrivateRelay: true } };
    act(() => result.current.setMethods(next));
    await waitFor(() => expect(result.current.methods).toEqual(next));
    expect(mockApiRequest).toHaveBeenCalledTimes(1);
  });
});
