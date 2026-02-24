/* eslint-disable no-console */
/**
 * Seed script: populates the exercise_library table with ~50 common exercises
 * and their MET values for calorie burn estimation.
 *
 * Usage: npx tsx server/scripts/seed-exercises.ts
 */
import "dotenv/config";
import { db, pool } from "../db";
import { exerciseLibrary } from "@shared/schema";

const EXERCISES = [
  // ── Cardio ────────────────────────────────────────────────────────────
  { name: "Walking (brisk)", type: "cardio", metValue: "3.5" },
  { name: "Running (6 mph)", type: "cardio", metValue: "9.8" },
  { name: "Running (8 mph)", type: "cardio", metValue: "11.8" },
  { name: "Cycling (moderate)", type: "cardio", metValue: "7.5" },
  { name: "Cycling (vigorous)", type: "cardio", metValue: "10.0" },
  { name: "Swimming (laps)", type: "cardio", metValue: "7.0" },
  { name: "Swimming (leisure)", type: "cardio", metValue: "4.5" },
  { name: "Jump Rope", type: "cardio", metValue: "12.3" },
  { name: "Rowing Machine", type: "cardio", metValue: "7.0" },
  { name: "Elliptical Trainer", type: "cardio", metValue: "5.0" },
  { name: "Stair Climbing", type: "cardio", metValue: "9.0" },
  { name: "HIIT", type: "cardio", metValue: "8.0" },
  { name: "Hiking", type: "cardio", metValue: "6.0" },
  { name: "Jogging", type: "cardio", metValue: "7.0" },
  { name: "Sprinting", type: "cardio", metValue: "15.0" },
  { name: "Dance (aerobic)", type: "cardio", metValue: "6.5" },
  { name: "Dance (general)", type: "cardio", metValue: "4.8" },
  { name: "Kickboxing", type: "cardio", metValue: "10.3" },
  { name: "Skiing (downhill)", type: "cardio", metValue: "6.0" },
  { name: "Skiing (cross-country)", type: "cardio", metValue: "9.0" },

  // ── Strength ──────────────────────────────────────────────────────────
  { name: "Weight Training (general)", type: "strength", metValue: "5.0" },
  { name: "Weight Training (vigorous)", type: "strength", metValue: "6.0" },
  { name: "Bench Press", type: "strength", metValue: "5.0" },
  { name: "Squats", type: "strength", metValue: "5.5" },
  { name: "Deadlifts", type: "strength", metValue: "6.0" },
  { name: "Pull-ups", type: "strength", metValue: "5.5" },
  { name: "Push-ups", type: "strength", metValue: "3.8" },
  { name: "Lunges", type: "strength", metValue: "5.0" },
  { name: "Kettlebell", type: "strength", metValue: "6.0" },
  { name: "Resistance Bands", type: "strength", metValue: "3.5" },
  { name: "Bodyweight Circuit", type: "strength", metValue: "5.0" },
  { name: "CrossFit", type: "strength", metValue: "8.0" },

  // ── Flexibility ───────────────────────────────────────────────────────
  { name: "Yoga (hatha)", type: "flexibility", metValue: "3.0" },
  { name: "Yoga (power/vinyasa)", type: "flexibility", metValue: "4.0" },
  { name: "Pilates", type: "flexibility", metValue: "3.0" },
  { name: "Stretching", type: "flexibility", metValue: "2.3" },
  { name: "Tai Chi", type: "flexibility", metValue: "3.0" },
  { name: "Foam Rolling", type: "flexibility", metValue: "2.0" },

  // ── Sports ────────────────────────────────────────────────────────────
  { name: "Basketball", type: "sports", metValue: "6.5" },
  { name: "Soccer", type: "sports", metValue: "7.0" },
  { name: "Tennis (singles)", type: "sports", metValue: "7.3" },
  { name: "Tennis (doubles)", type: "sports", metValue: "5.0" },
  { name: "Volleyball", type: "sports", metValue: "4.0" },
  { name: "Badminton", type: "sports", metValue: "5.5" },
  { name: "Table Tennis", type: "sports", metValue: "4.0" },
  { name: "Golf (carrying clubs)", type: "sports", metValue: "4.3" },
  { name: "Boxing (sparring)", type: "sports", metValue: "7.8" },
  { name: "Martial Arts", type: "sports", metValue: "10.3" },
  { name: "Rock Climbing", type: "sports", metValue: "8.0" },
  { name: "Ice Skating", type: "sports", metValue: "5.5" },
];

async function seed() {
  console.log("Seeding exercise library...");
  for (const exercise of EXERCISES) {
    await db
      .insert(exerciseLibrary)
      .values({
        name: exercise.name,
        type: exercise.type,
        metValue: exercise.metValue,
        isCustom: false,
        userId: null,
      })
      .onConflictDoNothing();
  }
  console.log(`Seeded ${EXERCISES.length} exercises`);
  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed error:", err);
  pool.end().then(() => process.exit(1));
});
