import { storage } from "../storage";

interface HealthKitWeightSample {
  weight: number;
  date: string;
  source: string;
}

interface HealthKitWorkout {
  name: string;
  type: string;
  durationMinutes: number;
  caloriesBurned: number;
  date: string;
  source: string;
}

interface HealthKitSyncData {
  weights?: HealthKitWeightSample[];
  workouts?: HealthKitWorkout[];
  steps?: { date: string; count: number }[];
}

export async function syncHealthKitData(
  userId: string,
  data: HealthKitSyncData,
): Promise<{ weightsSynced: number; workoutsSynced: number }> {
  let weightsSynced = 0;
  let workoutsSynced = 0;

  // Sync weight samples (deduplicate by checking existing entries)
  if (data.weights?.length) {
    for (const sample of data.weights) {
      // Simple dedup: check if weight at that exact time already exists
      const existing = await storage.getWeightLogs(userId, {
        from: new Date(sample.date),
        to: new Date(new Date(sample.date).getTime() + 60000), // 1 min window
        limit: 1,
      });
      if (existing.length === 0) {
        await storage.createWeightLog({
          userId,
          weight: sample.weight.toString(),
          source: "healthkit",
        });
        weightsSynced++;
      }
    }
    await storage.updateHealthKitLastSync(userId, "weight");
  }

  // Sync workouts
  if (data.workouts?.length) {
    for (const workout of data.workouts) {
      await storage.createExerciseLog({
        userId,
        exerciseName: workout.name,
        exerciseType: workout.type || "other",
        durationMinutes: workout.durationMinutes,
        caloriesBurned: workout.caloriesBurned?.toString(),
        source: "healthkit",
      });
      workoutsSynced++;
    }
    await storage.updateHealthKitLastSync(userId, "workouts");
  }

  return { weightsSynced, workoutsSynced };
}
