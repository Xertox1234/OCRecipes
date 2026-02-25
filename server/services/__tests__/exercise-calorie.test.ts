import { calculateCaloriesBurned } from "../exercise-calorie";

describe("Exercise Calorie Calculator", () => {
  describe("calculateCaloriesBurned", () => {
    it("calculates calories for a standard exercise", () => {
      // Running at 8 km/h (MET ~8.0), 70 kg person, 30 minutes
      const calories = calculateCaloriesBurned(8.0, 70, 30);

      // Expected: 8.0 * 70 * 0.5 = 280
      expect(calories).toBe(280);
    });

    it("returns 0 for zero duration", () => {
      const calories = calculateCaloriesBurned(8.0, 70, 0);
      expect(calories).toBe(0);
    });

    it("returns 0 for zero weight", () => {
      const calories = calculateCaloriesBurned(8.0, 0, 30);
      expect(calories).toBe(0);
    });

    it("returns 0 for zero MET value", () => {
      const calories = calculateCaloriesBurned(0, 70, 30);
      expect(calories).toBe(0);
    });

    it("calculates correctly for walking (low MET)", () => {
      // Walking at 5 km/h (MET ~3.5), 60 kg person, 60 minutes
      const calories = calculateCaloriesBurned(3.5, 60, 60);

      // Expected: 3.5 * 60 * 1.0 = 210
      expect(calories).toBe(210);
    });

    it("calculates correctly for vigorous exercise (high MET)", () => {
      // Sprinting (MET ~15.0), 80 kg person, 15 minutes
      const calories = calculateCaloriesBurned(15.0, 80, 15);

      // Expected: 15.0 * 80 * 0.25 = 300
      expect(calories).toBe(300);
    });

    it("rounds to the nearest integer", () => {
      // 5.5 * 65 * (45/60) = 5.5 * 65 * 0.75 = 268.125 → 268
      const calories = calculateCaloriesBurned(5.5, 65, 45);
      expect(calories).toBe(268);
    });

    it("rounds correctly at 0.5 boundary", () => {
      // Choose values that produce exactly X.5
      // 3.0 * 70 * (1/60) = 3.5 → rounds to 4 (Math.round)
      const calories = calculateCaloriesBurned(3.0, 70, 1);
      expect(calories).toBe(4); // 3.0 * 70 * (1/60) = 3.5 → Math.round(3.5) = 4
    });

    it("handles very long durations", () => {
      // Ultramarathon: MET 6.0, 70 kg, 720 minutes (12 hours)
      const calories = calculateCaloriesBurned(6.0, 70, 720);

      // Expected: 6.0 * 70 * 12 = 5040
      expect(calories).toBe(5040);
    });

    it("handles very light exercises (MET ~1)", () => {
      // Sitting/resting: MET 1.0, 70 kg, 60 minutes
      const calories = calculateCaloriesBurned(1.0, 70, 60);

      // Expected: 1.0 * 70 * 1.0 = 70
      expect(calories).toBe(70);
    });

    it("handles fractional MET values", () => {
      // Yoga: MET 2.5, 55 kg, 90 minutes
      const calories = calculateCaloriesBurned(2.5, 55, 90);

      // Expected: 2.5 * 55 * 1.5 = 206.25 → 206
      expect(calories).toBe(206);
    });

    it("handles very heavy person", () => {
      // Walking: MET 3.5, 150 kg, 30 minutes
      const calories = calculateCaloriesBurned(3.5, 150, 30);

      // Expected: 3.5 * 150 * 0.5 = 262.5 → 263
      expect(calories).toBe(263);
    });
  });
});
