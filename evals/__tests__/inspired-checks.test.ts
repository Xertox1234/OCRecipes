import { describe, it, expect } from "vitest";
import { checkSuggestionCards, containsTerm } from "../lib/inspired-checks";

const card = (title: string, description = "A tasty dish for tonight.") => ({
  title,
  description,
  totalMinutes: 20,
  tags: ["quick"],
});

describe("containsTerm", () => {
  it("matches whole words case-insensitively, tolerating punctuation", () => {
    expect(containsTerm("Crunchy Peanut. Slaw", "peanut")).toBe(true);
    expect(containsTerm("with peanuts, and rice", "peanuts")).toBe(true);
    expect(containsTerm("(PEANUT)", "peanut")).toBe(true);
  });
  it("ignores negated mentions but not affirmative ones", () => {
    expect(containsTerm("Medley of fish, shellfish-free", "shellfish")).toBe(
      false,
    );
    expect(containsTerm("Made without peanuts.", "peanuts")).toBe(false);
    expect(
      containsTerm("No shellfish here, but shellfish bisque", "shellfish"),
    ).toBe(true);
  });
  it("does not match inside other words", () => {
    expect(containsTerm("Peanutty bowl", "peanut")).toBe(false);
    expect(containsTerm("Chickpea stew", "chick")).toBe(false);
  });
  it("matches multi-word and regex-special terms literally", () => {
    expect(containsTerm("Peanut butter cups", "peanut butter")).toBe(true);
    expect(containsTerm("a c++ b", "c++")).toBe(true);
    expect(containsTerm("an a.b dish", "a.b")).toBe(true);
  });
});

describe("checkSuggestionCards", () => {
  it("fails on null", () => {
    expect(checkSuggestionCards(null, [], [])).toEqual(["returned null"]);
  });
  it("fails on more than 8 cards", () => {
    const cards = Array.from({ length: 9 }, (_, i) => card(`Dish ${i}`));
    expect(checkSuggestionCards(cards, [], [])[0]).toMatch(/1-8/);
  });
  it("flags a mustAvoid term in any field", () => {
    const f = checkSuggestionCards(
      [card("Green bowl", "Topped with crushed peanuts.")],
      ["peanut", "peanuts"],
      [],
    );
    expect(f.join()).toMatch(/peanuts/);
  });
  it("flags an inspiration title copy case-insensitively", () => {
    const f = checkSuggestionCards(
      [card("SPICY thai noodles")],
      [],
      ["Spicy Thai Noodles"],
    );
    expect(f.join()).toMatch(/copies inspiration/);
  });
  it("passes a clean list", () => {
    expect(
      checkSuggestionCards([card("Lentil soup")], ["beef"], ["x"]),
    ).toEqual([]);
  });
});
