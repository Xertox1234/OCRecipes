import { describe, it, expect } from "vitest";
import {
  calculateGoals,
  userPhysicalProfileSchema,
  type UserPhysicalProfile,
} from "../goal-calculator";

describe("Goal Calculator", () => {
  describe("calculateGoals", () => {
    it("calculates correct TDEE for sedentary male", () => {
      const profile: UserPhysicalProfile = {
        weight: 70, // kg
        height: 175, // cm
        age: 30,
        gender: "male",
        activityLevel: "sedentary",
        primaryGoal: "maintain",
      };

      const goals = calculateGoals(profile);

      // Mifflin-St Jeor: (10 * 70) + (6.25 * 175) - (5 * 30) + 5 = 1648.75 BMR
      // TDEE: 1648.75 * 1.2 = 1978.5
      expect(goals.dailyCalories).toBe(1979); // rounded
      expect(goals.dailyProtein).toBeGreaterThan(0);
      expect(goals.dailyCarbs).toBeGreaterThan(0);
      expect(goals.dailyFat).toBeGreaterThan(0);
    });

    it("calculates correct TDEE for active female", () => {
      const profile: UserPhysicalProfile = {
        weight: 60,
        height: 165,
        age: 25,
        gender: "female",
        activityLevel: "active",
        primaryGoal: "maintain",
      };

      const goals = calculateGoals(profile);

      // Mifflin-St Jeor female: (10 * 60) + (6.25 * 165) - (5 * 25) - 161 = 1345.25 BMR
      // TDEE: 1345.25 * 1.725 = 2320.56
      expect(goals.dailyCalories).toBe(2321); // rounded
    });

    it("applies -500 calorie deficit for lose_weight goal", () => {
      const maintainProfile: UserPhysicalProfile = {
        weight: 80,
        height: 180,
        age: 35,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const loseWeightProfile: UserPhysicalProfile = {
        ...maintainProfile,
        primaryGoal: "lose_weight",
      };

      const maintainGoals = calculateGoals(maintainProfile);
      const loseWeightGoals = calculateGoals(loseWeightProfile);

      expect(maintainGoals.dailyCalories - loseWeightGoals.dailyCalories).toBe(
        500,
      );
    });

    it("applies +300 calorie surplus for gain_muscle goal", () => {
      const maintainProfile: UserPhysicalProfile = {
        weight: 75,
        height: 178,
        age: 28,
        gender: "male",
        activityLevel: "active",
        primaryGoal: "maintain",
      };

      const gainMuscleProfile: UserPhysicalProfile = {
        ...maintainProfile,
        primaryGoal: "gain_muscle",
      };

      const maintainGoals = calculateGoals(maintainProfile);
      const gainMuscleGoals = calculateGoals(gainMuscleProfile);

      expect(gainMuscleGoals.dailyCalories - maintainGoals.dailyCalories).toBe(
        300,
      );
    });

    it("enforces minimum 1200 calories safety guardrail", () => {
      const profile: UserPhysicalProfile = {
        weight: 40, // Very low weight
        height: 150,
        age: 18,
        gender: "female",
        activityLevel: "sedentary",
        primaryGoal: "lose_weight", // -500 deficit
      };

      const goals = calculateGoals(profile);

      expect(goals.dailyCalories).toBeGreaterThanOrEqual(1200);
    });

    it("calculates higher protein ratio for lose_weight goal (40%)", () => {
      const profile: UserPhysicalProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "lose_weight",
      };

      const goals = calculateGoals(profile);

      // Protein should be 40% of calories / 4 cal per gram
      const expectedProtein = Math.round((goals.dailyCalories * 0.4) / 4);
      expect(goals.dailyProtein).toBe(expectedProtein);
    });

    it("calculates higher carbs ratio for gain_muscle goal (40%)", () => {
      const profile: UserPhysicalProfile = {
        weight: 75,
        height: 180,
        age: 25,
        gender: "male",
        activityLevel: "active",
        primaryGoal: "gain_muscle",
      };

      const goals = calculateGoals(profile);

      // Carbs should be 40% of calories / 4 cal per gram
      const expectedCarbs = Math.round((goals.dailyCalories * 0.4) / 4);
      expect(goals.dailyCarbs).toBe(expectedCarbs);
    });

    it("calculates fat using 9 calories per gram", () => {
      const profile: UserPhysicalProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain", // 30% fat
      };

      const goals = calculateGoals(profile);

      // Fat should be 30% of calories / 9 cal per gram
      const expectedFat = Math.round((goals.dailyCalories * 0.3) / 9);
      expect(goals.dailyFat).toBe(expectedFat);
    });

    it("treats gender 'other' same as female (conservative formula)", () => {
      const femaleProfile: UserPhysicalProfile = {
        weight: 65,
        height: 168,
        age: 28,
        gender: "female",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const otherProfile: UserPhysicalProfile = {
        ...femaleProfile,
        gender: "other",
      };

      const femaleGoals = calculateGoals(femaleProfile);
      const otherGoals = calculateGoals(otherProfile);

      expect(otherGoals.dailyCalories).toBe(femaleGoals.dailyCalories);
    });

    it("applies correct activity multipliers", () => {
      const baseProfile: UserPhysicalProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "sedentary",
        primaryGoal: "maintain",
      };

      const sedentary = calculateGoals({
        ...baseProfile,
        activityLevel: "sedentary",
      });
      const light = calculateGoals({ ...baseProfile, activityLevel: "light" });
      const moderate = calculateGoals({
        ...baseProfile,
        activityLevel: "moderate",
      });
      const active = calculateGoals({
        ...baseProfile,
        activityLevel: "active",
      });
      const athlete = calculateGoals({
        ...baseProfile,
        activityLevel: "athlete",
      });

      // Each level should be progressively higher
      expect(light.dailyCalories).toBeGreaterThan(sedentary.dailyCalories);
      expect(moderate.dailyCalories).toBeGreaterThan(light.dailyCalories);
      expect(active.dailyCalories).toBeGreaterThan(moderate.dailyCalories);
      expect(athlete.dailyCalories).toBeGreaterThan(active.dailyCalories);
    });
  });

  describe("userPhysicalProfileSchema", () => {
    it("validates correct profile data", () => {
      const validProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(validProfile);
      expect(result.success).toBe(true);
    });

    it("rejects weight below 20kg", () => {
      const invalidProfile = {
        weight: 15,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects weight above 500kg", () => {
      const invalidProfile = {
        weight: 600,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects height below 50cm", () => {
      const invalidProfile = {
        weight: 70,
        height: 40,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects height above 300cm", () => {
      const invalidProfile = {
        weight: 70,
        height: 350,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects age below 13", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 10,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects age above 120", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 130,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects non-integer age", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 30.5,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects invalid gender", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "unknown",
        activityLevel: "moderate",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects invalid activity level", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "super_athlete",
        primaryGoal: "maintain",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("rejects invalid primary goal", () => {
      const invalidProfile = {
        weight: 70,
        height: 175,
        age: 30,
        gender: "male",
        activityLevel: "moderate",
        primaryGoal: "get_ripped",
      };

      const result = userPhysicalProfileSchema.safeParse(invalidProfile);
      expect(result.success).toBe(false);
    });

    it("accepts all valid activity levels", () => {
      const activityLevels = [
        "sedentary",
        "light",
        "moderate",
        "active",
        "athlete",
      ];

      for (const level of activityLevels) {
        const profile = {
          weight: 70,
          height: 175,
          age: 30,
          gender: "male",
          activityLevel: level,
          primaryGoal: "maintain",
        };

        const result = userPhysicalProfileSchema.safeParse(profile);
        expect(result.success).toBe(true);
      }
    });

    it("accepts all valid primary goals", () => {
      const goals = [
        "lose_weight",
        "gain_muscle",
        "maintain",
        "eat_healthier",
        "manage_condition",
      ];

      for (const goal of goals) {
        const profile = {
          weight: 70,
          height: 175,
          age: 30,
          gender: "male",
          activityLevel: "moderate",
          primaryGoal: goal,
        };

        const result = userPhysicalProfileSchema.safeParse(profile);
        expect(result.success).toBe(true);
      }
    });
  });
});
