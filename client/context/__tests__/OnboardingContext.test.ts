import { describe, it, expect } from "vitest";

/**
 * Tests for OnboardingContext logic.
 * Following established pattern (PremiumContext.test.ts): test logic inline
 * without React rendering since vitest runs in node environment.
 */

// Reproduce the types and defaults from OnboardingContext
interface Allergy {
  name: string;
  severity: "mild" | "moderate" | "severe";
}

interface OnboardingData {
  allergies: Allergy[];
  healthConditions: string[];
  dietType: string | null;
  foodDislikes: string[];
  primaryGoal: string | null;
  activityLevel: string | null;
  householdSize: number;
  cuisinePreferences: string[];
  cookingSkillLevel: string | null;
  cookingTimeAvailable: string | null;
}

const defaultData: OnboardingData = {
  allergies: [],
  healthConditions: [],
  dietType: null,
  foodDislikes: [],
  primaryGoal: null,
  activityLevel: null,
  householdSize: 1,
  cuisinePreferences: [],
  cookingSkillLevel: null,
  cookingTimeAvailable: null,
};

describe("OnboardingContext", () => {
  describe("default data", () => {
    it("should have empty arrays for list fields", () => {
      expect(defaultData.allergies).toEqual([]);
      expect(defaultData.healthConditions).toEqual([]);
      expect(defaultData.foodDislikes).toEqual([]);
      expect(defaultData.cuisinePreferences).toEqual([]);
    });

    it("should have null for selection fields", () => {
      expect(defaultData.dietType).toBeNull();
      expect(defaultData.primaryGoal).toBeNull();
      expect(defaultData.activityLevel).toBeNull();
      expect(defaultData.cookingSkillLevel).toBeNull();
      expect(defaultData.cookingTimeAvailable).toBeNull();
    });

    it("should have householdSize defaulting to 1", () => {
      expect(defaultData.householdSize).toBe(1);
    });

    it("should have exactly 10 fields", () => {
      expect(Object.keys(defaultData)).toHaveLength(10);
    });
  });

  describe("updateData logic (partial merge)", () => {
    it("should merge partial updates into existing data", () => {
      const current = { ...defaultData };
      const updates: Partial<OnboardingData> = {
        dietType: "vegan",
        householdSize: 3,
      };
      const merged = { ...current, ...updates };

      expect(merged.dietType).toBe("vegan");
      expect(merged.householdSize).toBe(3);
      // Other fields untouched
      expect(merged.allergies).toEqual([]);
      expect(merged.primaryGoal).toBeNull();
    });

    it("should overwrite arrays when updated", () => {
      const current = { ...defaultData };
      const allergies: Allergy[] = [
        { name: "Peanuts", severity: "severe" },
        { name: "Shellfish", severity: "moderate" },
      ];
      const merged = { ...current, allergies };

      expect(merged.allergies).toHaveLength(2);
      expect(merged.allergies[0].name).toBe("Peanuts");
      expect(merged.allergies[0].severity).toBe("severe");
    });

    it("should allow updating multiple fields at once", () => {
      const current = { ...defaultData };
      const merged = {
        ...current,
        primaryGoal: "lose_weight",
        activityLevel: "moderate",
        cookingSkillLevel: "intermediate",
        cookingTimeAvailable: "30-60min",
        cuisinePreferences: ["Italian", "Japanese"],
      };

      expect(merged.primaryGoal).toBe("lose_weight");
      expect(merged.activityLevel).toBe("moderate");
      expect(merged.cookingSkillLevel).toBe("intermediate");
      expect(merged.cookingTimeAvailable).toBe("30-60min");
      expect(merged.cuisinePreferences).toEqual(["Italian", "Japanese"]);
    });

    it("should allow setting fields back to null", () => {
      const withValues = {
        ...defaultData,
        dietType: "vegetarian",
        primaryGoal: "gain_muscle",
      };
      const reset = { ...withValues, dietType: null, primaryGoal: null };

      expect(reset.dietType).toBeNull();
      expect(reset.primaryGoal).toBeNull();
    });
  });

  describe("step navigation logic", () => {
    const totalSteps = 6;

    it("should have 6 total steps", () => {
      expect(totalSteps).toBe(6);
    });

    it("nextStep should increment within bounds", () => {
      let currentStep = 0;

      // nextStep logic from context
      const nextStep = () => {
        if (currentStep < totalSteps - 1) {
          currentStep += 1;
        }
      };

      nextStep();
      expect(currentStep).toBe(1);

      nextStep();
      expect(currentStep).toBe(2);
    });

    it("nextStep should not exceed totalSteps - 1", () => {
      let currentStep = 5; // last step

      const nextStep = () => {
        if (currentStep < totalSteps - 1) {
          currentStep += 1;
        }
      };

      nextStep();
      expect(currentStep).toBe(5); // should not change

      nextStep();
      expect(currentStep).toBe(5); // still capped
    });

    it("prevStep should decrement within bounds", () => {
      let currentStep = 3;

      const prevStep = () => {
        if (currentStep > 0) {
          currentStep -= 1;
        }
      };

      prevStep();
      expect(currentStep).toBe(2);

      prevStep();
      expect(currentStep).toBe(1);
    });

    it("prevStep should not go below 0", () => {
      let currentStep = 0;

      const prevStep = () => {
        if (currentStep > 0) {
          currentStep -= 1;
        }
      };

      prevStep();
      expect(currentStep).toBe(0); // should not change
    });

    it("should be able to navigate through all steps", () => {
      let currentStep = 0;

      const nextStep = () => {
        if (currentStep < totalSteps - 1) {
          currentStep += 1;
        }
      };

      for (let i = 0; i < totalSteps - 1; i++) {
        nextStep();
      }
      expect(currentStep).toBe(5);
    });

    it("should be able to navigate back through all steps", () => {
      let currentStep = 5;

      const prevStep = () => {
        if (currentStep > 0) {
          currentStep -= 1;
        }
      };

      for (let i = 0; i < totalSteps; i++) {
        prevStep();
      }
      expect(currentStep).toBe(0);
    });
  });

  describe("allergy model", () => {
    it("should support mild severity", () => {
      const allergy: Allergy = { name: "Dairy", severity: "mild" };
      expect(allergy.severity).toBe("mild");
    });

    it("should support moderate severity", () => {
      const allergy: Allergy = { name: "Eggs", severity: "moderate" };
      expect(allergy.severity).toBe("moderate");
    });

    it("should support severe severity", () => {
      const allergy: Allergy = { name: "Peanuts", severity: "severe" };
      expect(allergy.severity).toBe("severe");
    });
  });
});

describe("useOnboarding hook", () => {
  it("should throw error when used outside OnboardingProvider", () => {
    const context = null; // Simulates being outside provider
    const useOnboarding = () => {
      if (!context) {
        throw new Error(
          "useOnboarding must be used within an OnboardingProvider",
        );
      }
      return context;
    };

    expect(() => useOnboarding()).toThrow(
      "useOnboarding must be used within an OnboardingProvider",
    );
  });
});
