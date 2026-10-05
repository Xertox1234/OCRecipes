import { describe, it, expect } from "vitest";
import { suggestUsername } from "../suggest-username";

const none = async () => false;

describe("suggestUsername", () => {
  it("derives from a name", async () => {
    expect(await suggestUsername("Jane Doe", none)).toBe("janedoe");
  });
  it("strips illegal characters and pads short seeds", async () => {
    expect(await suggestUsername("Zé", none)).toMatch(/^z[a-z0-9_]{2,}$/);
  });
  it("adds digits when taken", async () => {
    const taken = async (u: string) => u === "janedoe";
    expect(await suggestUsername("Jane Doe", taken)).toMatch(/^janedoe\d{4}$/);
  });
  it("falls back to user + digits with no seed", async () => {
    expect(await suggestUsername(null, none)).toMatch(/^user\d{6}$/);
  });
  it("never exceeds 30 characters", async () => {
    expect(
      (await suggestUsername("a".repeat(80), async () => true)).length,
    ).toBeLessThanOrEqual(30);
  });
});
