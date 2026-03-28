import { describe, it, expect } from "vitest";
import { escapeLike, getDayBounds } from "../helpers";

describe("escapeLike", () => {
  it("escapes percent sign", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscore", () => {
    expect(escapeLike("hello_world")).toBe("hello\\_world");
  });

  it("escapes backslash", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("escapes multiple metacharacters", () => {
    expect(escapeLike("50%_off\\sale")).toBe("50\\%\\_off\\\\sale");
  });

  it("returns unchanged string with no metacharacters", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeLike("")).toBe("");
  });

  it("handles string of only metacharacters", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });
});

describe("getDayBounds", () => {
  it("returns start of day at UTC midnight", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const { startOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCHours()).toBe(0);
    expect(startOfDay.getUTCMinutes()).toBe(0);
    expect(startOfDay.getUTCSeconds()).toBe(0);
    expect(startOfDay.getUTCMilliseconds()).toBe(0);
  });

  it("returns end of day at UTC 23:59:59.999", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const { endOfDay } = getDayBounds(date);

    expect(endOfDay.getUTCHours()).toBe(23);
    expect(endOfDay.getUTCMinutes()).toBe(59);
    expect(endOfDay.getUTCSeconds()).toBe(59);
    expect(endOfDay.getUTCMilliseconds()).toBe(999);
  });

  it("preserves the UTC date (year, month, day)", () => {
    const date = new Date("2024-12-25T08:00:00Z");
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCFullYear()).toBe(2024);
    expect(startOfDay.getUTCMonth()).toBe(11);
    expect(startOfDay.getUTCDate()).toBe(25);
    expect(endOfDay.getUTCFullYear()).toBe(2024);
    expect(endOfDay.getUTCMonth()).toBe(11);
    expect(endOfDay.getUTCDate()).toBe(25);
  });

  it("does not mutate the input date", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const originalTime = date.getTime();
    getDayBounds(date);
    expect(date.getTime()).toBe(originalTime);
  });

  it("handles UTC midnight input", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCHours()).toBe(0);
    expect(endOfDay.getUTCHours()).toBe(23);
  });
});
