import { describe, it, expect, vi, beforeEach } from "vitest";

import { storage } from "../../storage";
import { lookupBarcode, type BarcodeLookupResult } from "../barcode-lookup";
import { loadBarcodeScanContext } from "../barcode-scan-context";
import {
  createMockBarcodeVerification,
  createMockUserProfile,
} from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getVerification: vi.fn(),
    getUserProfile: vi.fn(),
  },
}));

vi.mock("../barcode-lookup", () => ({
  lookupBarcode: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn() },
  toError: (e: unknown) => e,
}));

describe("loadBarcodeScanContext", () => {
  const product = {
    productName: "Peanut bar",
  } as unknown as BarcodeLookupResult;
  const verification = createMockBarcodeVerification();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(lookupBarcode).mockResolvedValue(product);
    vi.mocked(storage.getVerification).mockResolvedValue(verification);
  });

  it("returns the lookup, verification and the user's parsed allergies", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(
      createMockUserProfile({
        allergies: [{ name: "peanuts", severity: "severe" }],
      }),
    );

    const ctx = await loadBarcodeScanContext("123", "user-1");

    expect(lookupBarcode).toHaveBeenCalledWith("123");
    expect(storage.getVerification).toHaveBeenCalledWith("123");
    expect(storage.getUserProfile).toHaveBeenCalledWith("user-1");
    expect(ctx.result).toBe(product);
    expect(ctx.verification).toBe(verification);
    expect(ctx.profileOutcome.ok).toBe(true);
    if (ctx.profileOutcome.ok) {
      expect(ctx.profileOutcome.allergies).toHaveLength(1);
    }
  });

  it("degrades a failed profile read to ok:false instead of throwing (allergen flags fail dangerous)", async () => {
    vi.mocked(storage.getUserProfile).mockRejectedValue(new Error("db down"));

    const ctx = await loadBarcodeScanContext("123", "user-1");

    expect(ctx.profileOutcome).toEqual({ ok: false });
    expect(ctx.result).toBe(product);
  });

  it("still rejects when the product lookup itself fails", async () => {
    vi.mocked(storage.getUserProfile).mockResolvedValue(undefined);
    vi.mocked(lookupBarcode).mockRejectedValue(new Error("upstream"));

    await expect(loadBarcodeScanContext("123", "user-1")).rejects.toThrow(
      "upstream",
    );
  });
});
