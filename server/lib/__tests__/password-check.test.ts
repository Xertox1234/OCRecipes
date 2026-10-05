import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcrypt";
import { passwordMatches } from "../password-check";

describe("passwordMatches", () => {
  it("is false for a NULL hash and still runs one bcrypt compare", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await expect(passwordMatches("anything", null)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is true for the right password", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    await expect(passwordMatches("correct horse", hash)).resolves.toBe(true);
  });

  it("is false for the wrong password", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    await expect(passwordMatches("nope", hash)).resolves.toBe(false);
  });
});
