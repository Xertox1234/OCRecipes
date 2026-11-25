import { describe, it, expect } from "vitest";
import { renderPantryExpiryNudge } from "../pantry-expiry-nudge";

const IT = " Want an idea for using it up?";
const THEM = " Want an idea for using them up?";

describe("renderPantryExpiryNudge", () => {
  it("names one item in the Coach's message, in the singular", () => {
    const n = renderPantryExpiryNudge(["Spinach"]);
    expect(n?.title).toBe("Use it before it goes");
    expect(n?.message).toBe(`Your spinach expires within a day.${IT}`);
  });

  it("keeps the names off the lock screen: the push only counts the items", () => {
    expect(renderPantryExpiryNudge(["Insulin"])?.body).toBe(
      "1 item in your pantry expires within a day.",
    );
    expect(renderPantryExpiryNudge(["a", "b", "c", "d"])?.body).toBe(
      "4 items in your pantry expire within a day.",
    );
    // The count is of distinct, usable names, as the message lists them.
    expect(renderPantryExpiryNudge(["Milk", "milk ", ""])?.body).toBe(
      "1 item in your pantry expires within a day.",
    );
  });

  it("joins two items with 'and'", () => {
    expect(
      renderPantryExpiryNudge(["spinach", "chicken thighs"])?.message,
    ).toBe(`Your spinach and chicken thighs expire within a day.${THEM}`);
  });

  it("names three items", () => {
    expect(renderPantryExpiryNudge(["a", "b", "c"])?.message).toBe(
      `Your a, b and c expire within a day.${THEM}`,
    );
  });

  it("names the first two and counts the rest past three", () => {
    expect(renderPantryExpiryNudge(["a", "b", "c", "d", "e"])?.message).toBe(
      `Your a, b and 3 more items expire within a day.${THEM}`,
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
    expect(n?.message).toBe(
      `Your greek yogurt and ${"x".repeat(39)}… expire within a day.${THEM}`,
    );
  });

  it("drops invisible and control characters and never cuts an emoji in half", () => {
    const hidden = "mi​lk‮\u0007";
    expect(renderPantryExpiryNudge([hidden])?.message).toBe(
      `Your milk expires within a day.${IT}`,
    );
    const emoji = "🥬".repeat(45);
    expect(renderPantryExpiryNudge([emoji])?.message).toBe(
      `Your ${"🥬".repeat(39)}… expires within a day.${IT}`,
    );
  });

  it("returns null when no name is usable", () => {
    expect(renderPantryExpiryNudge([])).toBeNull();
    expect(renderPantryExpiryNudge(["  ", ""])).toBeNull();
  });
});
