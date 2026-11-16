import {
  familyProfileInputSchema,
  mealAudienceInputSchema,
  isFamilyPlanningActive,
  MEAL_AUDIENCES,
  MAX_FAMILY_PROFILES,
  FAMILY_NAME_MAX,
  FAMILY_NOTE_MAX,
  FAMILY_ALLERGIES_MAX,
} from "../types/family";

describe("family limits", () => {
  it("uses the planned limits", () => {
    expect(MEAL_AUDIENCES).toEqual(["self", "shared", "profile"]);
    expect(MAX_FAMILY_PROFILES).toBe(8);
    expect(FAMILY_NAME_MAX).toBe(50);
    expect(FAMILY_NOTE_MAX).toBe(200);
    expect(FAMILY_ALLERGIES_MAX).toBe(30);
  });
});

describe("familyProfileInputSchema", () => {
  it("trims the name and turns an empty note into null", () => {
    expect(
      familyProfileInputSchema.parse({
        name: "  Ivy ",
        allergies: [],
        note: "",
      }),
    ).toEqual({ name: "Ivy", allergies: [], note: null });
  });

  it("turns a whitespace-only note into null", () => {
    expect(
      familyProfileInputSchema.parse({
        name: "Ivy",
        allergies: [],
        note: "  ",
      }),
    ).toEqual({ name: "Ivy", allergies: [], note: null });
  });

  it("rejects a blank name", () => {
    expect(
      familyProfileInputSchema.safeParse({
        name: "   ",
        allergies: [],
        note: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a name over 50 characters", () => {
    expect(
      familyProfileInputSchema.safeParse({
        name: "x".repeat(51),
        allergies: [],
        note: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a note over 200 characters", () => {
    expect(
      familyProfileInputSchema.safeParse({
        name: "Ivy",
        allergies: [],
        note: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("rejects more than 30 allergies", () => {
    expect(
      familyProfileInputSchema.safeParse({
        name: "Ivy",
        allergies: Array(31).fill({ name: "milk", severity: "mild" }),
        note: null,
      }).success,
    ).toBe(false);
  });
});

describe("mealAudienceInputSchema", () => {
  it("rejects a profile audience without an id", () => {
    expect(
      mealAudienceInputSchema.safeParse({
        audience: "profile",
        familyProfileId: null,
      }).success,
    ).toBe(false);
  });

  it("rejects a non-profile audience with an id", () => {
    expect(
      mealAudienceInputSchema.safeParse({
        audience: "shared",
        familyProfileId: 3,
      }).success,
    ).toBe(false);
  });

  it("accepts a profile audience with an id", () => {
    expect(
      mealAudienceInputSchema.parse({
        audience: "profile",
        familyProfileId: 3,
      }),
    ).toEqual({ audience: "profile", familyProfileId: 3 });
  });

  it("accepts self with no id", () => {
    expect(
      mealAudienceInputSchema.parse({
        audience: "self",
        familyProfileId: null,
      }),
    ).toEqual({ audience: "self", familyProfileId: null });
  });
});

describe("isFamilyPlanningActive", () => {
  it("needs both the premium flag and the switch", () => {
    expect(
      isFamilyPlanningActive(
        { familyProfiles: true },
        { familyPlanningEnabled: true },
      ),
    ).toBe(true);
    expect(
      isFamilyPlanningActive(
        { familyProfiles: false },
        { familyPlanningEnabled: true },
      ),
    ).toBe(false);
    expect(
      isFamilyPlanningActive(
        { familyProfiles: true },
        { familyPlanningEnabled: false },
      ),
    ).toBe(false);
    expect(isFamilyPlanningActive({ familyProfiles: true }, null)).toBe(false);
    expect(isFamilyPlanningActive({ familyProfiles: true }, undefined)).toBe(
      false,
    );
  });

  describe("an omitted note", () => {
    it("is accepted and stored as null, since the note is optional", () => {
      expect(
        familyProfileInputSchema.parse({ name: "Ivy", allergies: [] }),
      ).toEqual({ name: "Ivy", allergies: [], note: null });
    });

    it("still rejects a note that is not text", () => {
      expect(
        familyProfileInputSchema.safeParse({
          name: "Ivy",
          allergies: [],
          note: 5,
        }).success,
      ).toBe(false);
    });
  });
});
