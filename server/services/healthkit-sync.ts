import { storage } from "../storage";

interface HealthKitWeightSample {
  weight: number;
  date: string;
  source: string;
}

interface HealthKitSyncData {
  weights?: HealthKitWeightSample[];
  steps?: { date: string; count: number }[];
}

export async function syncHealthKitData(
  userId: string,
  data: HealthKitSyncData,
): Promise<{ weightsSynced: number }> {
  let weightsSynced = 0;

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
        // HealthKit always sends weight in kg. Store with explicit unit so the
        // trend math stays unit-consistent with manually-entered weights (which
        // are normalized to kg in the weight route before storage). See M25.
        await storage.createWeightLog({
          userId,
          weight: sample.weight.toFixed(2),
          unit: "kg",
          source: "healthkit",
        });
        weightsSynced++;
      }
    }
    await storage.updateHealthKitLastSync(userId, "weight");
  }

  return { weightsSynced };
}
