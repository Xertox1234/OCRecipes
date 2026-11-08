import { describe, it, expect, vi } from "vitest";
import { clearSiteData } from "../src/clear";

describe("clearSiteData", () => {
  it("returns false and does not throw when the native call rejects", async () => {
    const native = { clearAll: vi.fn().mockRejectedValue(new Error("boom")) };
    await expect(clearSiteData(native)).resolves.toBe(false);
    expect(native.clearAll).toHaveBeenCalledTimes(1);
  });

  it("returns true on success", async () => {
    const native = { clearAll: vi.fn().mockResolvedValue(true) };
    await expect(clearSiteData(native)).resolves.toBe(true);
  });

  it("returns false when the native module is absent (Expo Go, Vitest)", async () => {
    await expect(clearSiteData(null)).resolves.toBe(false);
  });

  it("returns false when the native call throws synchronously", async () => {
    const native = {
      clearAll: vi.fn(() => {
        throw new Error("sync");
      }),
    };
    await expect(clearSiteData(native)).resolves.toBe(false);
  });
});
