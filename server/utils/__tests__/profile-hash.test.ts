import { calculateProfileHash } from "../profile-hash";

describe("Profile Hash", () => {
  describe("calculateProfileHash", () => {
    it("returns a hex string", () => {
      const hash = calculateProfileHash(undefined);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("returns consistent hash for same input", () => {
      const profile = {
        allergies: [{ name: "Peanuts", severity: "severe" }],
        dietType: "vegetarian",
        cookingSkillLevel: "intermediate",
        cookingTimeAvailable: "30 minutes",
      } as any;

      const hash1 = calculateProfileHash(profile);
      const hash2 = calculateProfileHash(profile);
      expect(hash1).toBe(hash2);
    });

    it("returns different hash for different allergies", () => {
      const profile1 = {
        allergies: [{ name: "Peanuts", severity: "severe" }],
        dietType: null,
        cookingSkillLevel: null,
        cookingTimeAvailable: null,
      } as any;

      const profile2 = {
        allergies: [{ name: "Shellfish", severity: "mild" }],
        dietType: null,
        cookingSkillLevel: null,
        cookingTimeAvailable: null,
      } as any;

      expect(calculateProfileHash(profile1)).not.toBe(
        calculateProfileHash(profile2),
      );
    });

    it("returns different hash for different diet types", () => {
      const profile1 = { dietType: "vegan" } as any;
      const profile2 = { dietType: "keto" } as any;

      expect(calculateProfileHash(profile1)).not.toBe(
        calculateProfileHash(profile2),
      );
    });

    it("handles undefined profile", () => {
      const hash = calculateProfileHash(undefined);
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe("string");
    });

    it("handles profile with missing fields", () => {
      const hash = calculateProfileHash({} as any);
      // Should use defaults: allergies=[], dietType=null, etc.
      expect(hash).toBeTruthy();
    });

    it("undefined profile and empty-fields profile produce same hash", () => {
      const hashUndefined = calculateProfileHash(undefined);
      const hashEmpty = calculateProfileHash({
        allergies: [],
        dietType: null,
        cookingSkillLevel: null,
        cookingTimeAvailable: null,
      } as any);
      // Both should resolve to same defaults
      expect(hashUndefined).toBe(hashEmpty);
    });

    it("only uses suggestion-relevant fields for hashing", () => {
      // Two profiles identical in suggestion-relevant fields but different in others
      const profile1 = {
        allergies: [],
        dietType: "vegan",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "15 minutes",
        // Non-hashed fields:
        primaryGoal: "lose_weight",
        activityLevel: "active",
      } as any;

      const profile2 = {
        allergies: [],
        dietType: "vegan",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "15 minutes",
        // Non-hashed fields:
        primaryGoal: "build_muscle",
        activityLevel: "sedentary",
      } as any;

      expect(calculateProfileHash(profile1)).toBe(
        calculateProfileHash(profile2),
      );
    });
  });
});
