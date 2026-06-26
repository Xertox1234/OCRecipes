// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCatalogConfig } from "../useCatalogConfig";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { ApiError } from "../../lib/api-error";

const { mockApiRequest } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("useCatalogConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the catalog config endpoint and returns { enabled: true }", async () => {
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: true }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCatalogConfig(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ enabled: true });
  });

  it("fetches the catalog config endpoint and returns { enabled: false }", async () => {
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false }),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCatalogConfig(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ enabled: false });
  });

  it("surfaces a structured error when the response shape is invalid", async () => {
    // Invalid shape: missing the `enabled` key
    mockApiRequest.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCatalogConfig(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).code).toBe(
      "INVALID_RESPONSE_SHAPE",
    );
    expect(result.current.data).toBeUndefined();
  });
});
