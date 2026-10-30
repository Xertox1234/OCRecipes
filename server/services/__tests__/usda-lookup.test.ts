import { describe, it, expect, vi, beforeEach } from "vitest";

import { lookupUSDAByUPC, _resetUsdaBreakerForTesting } from "../usda-lookup";

const { mockLog, mockCachedFetch } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockCachedFetch: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => mockLog,
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));
vi.mock("../dev-api-cache", () => ({ cachedFetch: mockCachedFetch }));

const warnMessages = () => mockLog.warn.mock.calls.map((c) => c[1] as string);

describe("lookupUSDAByUPC — failures are logged, not silent (R43)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetUsdaBreakerForTesting();
  });

  it("logs the status when USDA answers non-OK", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
    });

    await expect(lookupUSDAByUPC("6073114236")).resolves.toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 403 }),
      expect.any(String),
    );
  });

  it("logs schema drift instead of treating it as 'not in USDA'", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ foods: "not-an-array" }),
    });

    await expect(lookupUSDAByUPC("6073114236")).resolves.toBeNull();
    expect(warnMessages().some((m) => /schema/i.test(m))).toBe(true);
  });

  it("logs a thrown error (e.g. invalid JSON body) with the error attached", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });

    await expect(lookupUSDAByUPC("6073114236")).resolves.toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(SyntaxError) }),
      expect.any(String),
    );
  });

  it("stays silent for a genuine no-match (empty foods)", async () => {
    mockCachedFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ foods: [] }),
    });

    await expect(lookupUSDAByUPC("6073114236")).resolves.toBeNull();
    expect(mockLog.warn).not.toHaveBeenCalled();
  });
});
