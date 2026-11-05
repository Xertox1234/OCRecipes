import { describe, it, expect } from "vitest";
import { isUser } from "../auth";

describe("isUser", () => {
  it("accepts an object with string id and username", () => {
    expect(isUser({ id: "u1", username: "sam" })).toBe(true);
    expect(isUser({ id: "u1", username: "sam", email: "a@b.c" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["a number", 42],
    ["a string", "u1"],
    ["an array", [{ id: "u1", username: "sam" }]],
    ["no id", { username: "sam" }],
    ["numeric id", { id: 1, username: "sam" }],
    ["no username", { id: "u1" }],
    ["non-string username", { id: "u1", username: 42 }],
  ])("rejects %s", (_label, value) => {
    expect(isUser(value)).toBe(false);
  });
});
