import { describe, it, expect, vi } from "vitest";
import { proOnly } from "../coach-pro-chat/pro-only";

describe("proOnly", () => {
  it("runs the fetch for Coach Pro and returns its result", async () => {
    const fetch = vi.fn().mockResolvedValue([1, 2]);
    await expect(proOnly(true, fetch, [])).resolves.toEqual([1, 2]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("skips the fetch for the free tier and returns the empty value", async () => {
    const fetch = vi.fn().mockResolvedValue([1, 2]);
    const empty: number[] = [];
    await expect(proOnly(false, fetch, empty)).resolves.toBe(empty);
    expect(fetch).not.toHaveBeenCalled();
  });
});
