import { goalFieldError } from "../GoalSetupScreen-utils";

describe("goalFieldError", () => {
  it("refuses an age below the range with the range message", () => {
    expect(goalFieldError("age", "5", "metric")).toBe("Age must be 13–120");
  });

  it("refuses a fractional age instead of truncating it", () => {
    expect(goalFieldError("age", "30.5", "metric")).toBe("Age must be 13–120");
  });

  it("accepts a comma-decimal weight", () => {
    expect(goalFieldError("weight", "70,5", "metric")).toBeNull();
  });

  it("names metric weight bounds in kg", () => {
    expect(goalFieldError("weight", "20", "metric")).toBe(
      "Weight must be 25–350 kg",
    );
  });

  it("names imperial weight bounds in whole pounds, in the field label's unit", () => {
    // kgToLbs(25) = 55.1, kgToLbs(350) = 771.6
    expect(goalFieldError("weight", "40", "imperial")).toBe(
      "Weight must be 55–772 lbs",
    );
  });

  it("checks the imperial value against the rounded bounds the message shows", () => {
    expect(goalFieldError("weight", "55", "imperial")).toBeNull();
    expect(goalFieldError("weight", "772", "imperial")).toBeNull();
    expect(goalFieldError("weight", "773", "imperial")).toBe(
      "Weight must be 55–772 lbs",
    );
  });

  it("names height bounds in cm, or whole inches for imperial", () => {
    expect(goalFieldError("height", "90", "metric")).toBe(
      "Height must be 100–250 cm",
    );
    // cmToInches(100) = 39.4, cmToInches(250) = 98.4
    expect(goalFieldError("height", "30", "imperial")).toBe(
      "Height must be 39–98 in",
    );
    expect(goalFieldError("height", "67", "imperial")).toBeNull();
  });

  it("checks calories and macros, which do not depend on the unit", () => {
    expect(goalFieldError("calories", "500", "metric")).toBe(
      "Calories must be 800–6000",
    );
    expect(goalFieldError("calories", "2200", "imperial")).toBeNull();
    expect(goalFieldError("carbs", "1000", "metric")).toBeNull();
    expect(goalFieldError("carbs", "1001", "metric")).toBe(
      "Carbs must be 0–1000 g",
    );
    expect(goalFieldError("carbs", "0", "metric")).toBeNull();
    expect(goalFieldError("fat", "70.5", "metric")).toBe("Fat must be 0–500 g");
  });

  // The server caps protein and fat at 500 g (server/routes/goals.ts); the
  // client must never accept what the server refuses.
  it("caps protein and fat at the server's 500 g", () => {
    expect(goalFieldError("protein", "500", "metric")).toBeNull();
    expect(goalFieldError("protein", "501", "metric")).toBe(
      "Protein must be 0–500 g",
    );
    expect(goalFieldError("fat", "500", "metric")).toBeNull();
    expect(goalFieldError("fat", "700", "metric")).toBe("Fat must be 0–500 g");
  });

  it("refuses junk text with the range message", () => {
    expect(goalFieldError("height", "abc", "metric")).toBe(
      "Height must be 100–250 cm",
    );
  });

  it("leaves an empty field to the 'Still needed' line", () => {
    expect(goalFieldError("age", "", "metric")).toBeNull();
    expect(goalFieldError("weight", "  ", "imperial")).toBeNull();
  });
});
