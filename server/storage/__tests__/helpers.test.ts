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
  it("returns start of day at midnight", () => {
    const date = new Date(2024, 5, 15, 14, 30, 45, 500);
    const { startOfDay } = getDayBounds(date);

    expect(startOfDay.getHours()).toBe(0);
    expect(startOfDay.getMinutes()).toBe(0);
    expect(startOfDay.getSeconds()).toBe(0);
    expect(startOfDay.getMilliseconds()).toBe(0);
  });

  it("returns end of day at 23:59:59.999", () => {
    const date = new Date(2024, 5, 15, 14, 30, 45, 500);
    const { endOfDay } = getDayBounds(date);

    expect(endOfDay.getHours()).toBe(23);
    expect(endOfDay.getMinutes()).toBe(59);
    expect(endOfDay.getSeconds()).toBe(59);
    expect(endOfDay.getMilliseconds()).toBe(999);
  });

  it("preserves the date (year, month, day)", () => {
    const date = new Date(2024, 11, 25, 8, 0, 0); // Dec 25, 2024
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getFullYear()).toBe(2024);
    expect(startOfDay.getMonth()).toBe(11);
    expect(startOfDay.getDate()).toBe(25);
    expect(endOfDay.getFullYear()).toBe(2024);
    expect(endOfDay.getMonth()).toBe(11);
    expect(endOfDay.getDate()).toBe(25);
  });

  it("does not mutate the input date", () => {
    const date = new Date(2024, 5, 15, 14, 30, 45, 500);
    const originalTime = date.getTime();
    getDayBounds(date);
    expect(date.getTime()).toBe(originalTime);
  });

  it("handles midnight input", () => {
    const date = new Date(2024, 0, 1, 0, 0, 0, 0);
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getHours()).toBe(0);
    expect(endOfDay.getHours()).toBe(23);
  });
});
