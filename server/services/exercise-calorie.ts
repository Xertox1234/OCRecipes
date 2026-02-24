/**
 * MET-based calorie burn calculator.
 * Formula: calories = MET * weight_kg * duration_hours
 */
export function calculateCaloriesBurned(
  metValue: number,
  weightKg: number,
  durationMinutes: number,
): number {
  const durationHours = durationMinutes / 60;
  return Math.round(metValue * weightKg * durationHours);
}
