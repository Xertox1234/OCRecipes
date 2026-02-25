import { storage } from "../storage";
import type { Glp1Insights } from "@shared/types/medication";

export type { Glp1Insights } from "@shared/types/medication";

export async function analyzeGlp1Insights(
  userId: string,
): Promise<Glp1Insights> {
  const [logs, profile, weightLogs] = await Promise.all([
    storage.getMedicationLogs(userId, { limit: 100 }),
    storage.getUserProfile(userId),
    storage.getWeightLogs(userId, { limit: 100 }),
  ]);

  const insights: Glp1Insights = {
    totalDoses: logs.length,
    daysSinceStart: null,
    averageAppetiteLevel: null,
    appetiteTrend: null,
    commonSideEffects: [],
    weightChangeSinceStart: null,
    lastDoseAt: null,
    nextDoseEstimate: null,
  };

  if (logs.length === 0) return insights;

  // Days since start
  const glp1StartDate = profile?.glp1StartDate;
  if (glp1StartDate) {
    const start = new Date(glp1StartDate);
    insights.daysSinceStart = Math.floor(
      (Date.now() - start.getTime()) / (1000 * 60 * 60 * 24),
    );
  }

  // Average appetite level
  const appetiteLogs = logs.filter((l) => l.appetiteLevel != null);
  if (appetiteLogs.length > 0) {
    const sum = appetiteLogs.reduce((acc, l) => acc + l.appetiteLevel!, 0);
    insights.averageAppetiteLevel =
      Math.round((sum / appetiteLogs.length) * 10) / 10;

    // Appetite trend (compare first half vs second half)
    if (appetiteLogs.length >= 4) {
      const mid = Math.floor(appetiteLogs.length / 2);
      const firstHalf = appetiteLogs.slice(mid); // older (sorted desc)
      const secondHalf = appetiteLogs.slice(0, mid); // newer
      const firstAvg =
        firstHalf.reduce((a, l) => a + l.appetiteLevel!, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((a, l) => a + l.appetiteLevel!, 0) /
        secondHalf.length;
      const diff = secondAvg - firstAvg;
      if (diff < -0.5) insights.appetiteTrend = "decreasing";
      else if (diff > 0.5) insights.appetiteTrend = "increasing";
      else insights.appetiteTrend = "stable";
    }
  }

  // Common side effects
  const sideEffectCounts = new Map<string, number>();
  for (const log of logs) {
    const effects = log.sideEffects;
    if (Array.isArray(effects)) {
      for (const effect of effects) {
        if (typeof effect === "string") {
          sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
        }
      }
    }
  }
  insights.commonSideEffects = Array.from(sideEffectCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Weight change since start
  if (glp1StartDate && weightLogs.length > 0) {
    const startDate = new Date(glp1StartDate);
    const beforeStart = weightLogs.filter(
      (w) => new Date(w.loggedAt) <= startDate,
    );
    const latest = weightLogs[0]; // most recent (sorted desc)
    if (beforeStart.length > 0 && latest) {
      const startWeight = parseFloat(beforeStart[0].weight);
      const currentWeight = parseFloat(latest.weight);
      insights.weightChangeSinceStart =
        Math.round((currentWeight - startWeight) * 100) / 100;
    }
  }

  // Last dose and next dose estimate
  insights.lastDoseAt = logs[0].takenAt.toISOString();
  if (logs.length >= 2) {
    // Estimate interval from average gap between doses
    const intervals: number[] = [];
    for (let i = 0; i < Math.min(logs.length - 1, 5); i++) {
      const gap =
        new Date(logs[i].takenAt).getTime() -
        new Date(logs[i + 1].takenAt).getTime();
      intervals.push(gap);
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const nextDose = new Date(
      new Date(logs[0].takenAt).getTime() + avgInterval,
    );
    insights.nextDoseEstimate = nextDose.toISOString();
  }

  return insights;
}
