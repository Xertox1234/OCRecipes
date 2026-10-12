import { toSecondPerson } from "../notebook-text-utils";

describe("toSecondPerson", () => {
  it("rewrites a leading possessive", () => {
    expect(toSecondPerson("User's breakfast consists of eggs")).toBe(
      "Your breakfast consists of eggs",
    );
  });

  it("rewrites common leading verbs", () => {
    expect(toSecondPerson("User has a peanut allergy")).toBe(
      "You have a peanut allergy",
    );
    expect(toSecondPerson("User is vegetarian")).toBe("You are vegetarian");
    expect(toSecondPerson("User committed to 3 workouts")).toBe(
      "You committed to 3 workouts",
    );
    expect(toSecondPerson("User wants more protein")).toBe(
      "You want more protein",
    );
  });

  it("handles -oes verbs and contractions", () => {
    expect(toSecondPerson("User goes to the gym")).toBe("You go to the gym");
    expect(toSecondPerson("User doesn't eat meat")).toBe("You don't eat meat");
    expect(toSecondPerson("User isn't vegan")).toBe("You aren't vegan");
  });

  it("leaves other text untouched", () => {
    expect(toSecondPerson("Eats late on weekends")).toBe(
      "Eats late on weekends",
    );
    expect(toSecondPerson("Username policy")).toBe("Username policy");
  });
});
