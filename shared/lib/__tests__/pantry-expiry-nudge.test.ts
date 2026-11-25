import { describe, it, expect } from "vitest";
import { renderPantryExpiryNudge } from "../pantry-expiry-nudge";

describe("renderPantryExpiryNudge", () => {
  it("names one item in the singular", () => {
    const n = renderPantryExpiryNudge(["Spinach"]);
    expect(n?.title).toBe("Use it before it goes");
    expect(n?.body).toBe("Your spinach expires within a day.");
    expect(n?.message).toBe(
      "Your spinach expires within a day. Want an idea for using it up?",
    );
  });

  it("joins two items with 'and'", () => {
    const n = renderPantryExpiryNudge(["spinach", "chicken thighs"]);
    expect(n?.body).toBe(
      "Your spinach and chicken thighs expire within a day.",
    );
    expect(n?.message).toContain("Want an idea for using them up?");
  });

  it("names three items", () => {
    expect(renderPantryExpiryNudge(["a", "b", "c"])?.body).toBe(
      "Your a, b and c expire within a day.",
    );
  });

  it("names the first two and counts the rest past three", () => {
    expect(renderPantryExpiryNudge(["a", "b", "c", "d", "e"])?.body).toBe(
      "Your a, b and 3 more items expire within a day.",
    );
  });

  it("flattens and shortens a name, and drops empty and repeated ones", () => {
    const long = "x".repeat(80);
    const n = renderPantryExpiryNudge([
      "  Greek\n yogurt ",
      "",
      "GREEK YOGURT",
      long,
    ]);
    expect(n?.body).toBe(
      `Your greek yogurt and ${"x".repeat(39)}… expire within a day.`,
    );
  });

  it("returns null when no name is usable", () => {
    expect(renderPantryExpiryNudge([])).toBeNull();
    expect(renderPantryExpiryNudge(["  ", ""])).toBeNull();
  });
});
