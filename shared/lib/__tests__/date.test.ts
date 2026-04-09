import { describe, it, expect } from "vitest";
import { toDateString } from "../date";

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toDateString(new Date("2024-01-05T12:00:00Z"))).toBe("2024-01-05");
  });

  it("handles start of day UTC", () => {
    expect(toDateString(new Date("2024-06-15T00:00:00Z"))).toBe("2024-06-15");
  });

  it("handles end of day UTC", () => {
    expect(toDateString(new Date("2024-12-31T23:59:59Z"))).toBe("2024-12-31");
  });

  it("uses UTC date (not local timezone)", () => {
    // Date just past midnight UTC — should always be the UTC date
    const date = new Date("2024-03-01T00:30:00Z");
    expect(toDateString(date)).toBe("2024-03-01");
  });

  it("handles leap year date", () => {
    expect(toDateString(new Date("2024-02-29T10:00:00Z"))).toBe("2024-02-29");
  });
});
