import type { FastingStats } from "@shared/types/fasting";
import type { FastingLog } from "@shared/schema";
import { toDateString } from "@shared/lib/date";

export type { FastingStats } from "@shared/types/fasting";

export function calculateFastingStats(logs: FastingLog[]): FastingStats {
  const completedLogs = logs.filter((l) => l.completed);
  const totalFasts = logs.length;
  const completedFasts = completedLogs.length;
  const completionRate = totalFasts > 0 ? completedFasts / totalFasts : 0;

  // Average duration of completed fasts
  const avgDuration =
    completedLogs.length > 0
      ? completedLogs.reduce(
          (sum, l) => sum + (l.actualDurationMinutes || 0),
          0,
        ) / completedLogs.length
      : 0;

  // Calculate streaks (consecutive completed fasts by day)
  const sortedCompleted = completedLogs
    .map((l) => {
      const date = new Date(l.startedAt);
      return { date, dateStr: toDateString(date) };
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  let currentStreak = 0;
  let longestStreak = 0;
  let streak = 0;
  const uniqueDays = [...new Set(sortedCompleted.map((s) => s.dateStr))]
    .sort()
    .reverse();

  for (let i = 0; i < uniqueDays.length; i++) {
    if (i === 0) {
      // Check if the most recent fast is today or yesterday
      const today = toDateString(new Date());
      const yesterday = toDateString(new Date(Date.now() - 86400000));
      if (uniqueDays[0] !== today && uniqueDays[0] !== yesterday) {
        currentStreak = 0;
        break;
      }
      streak = 1;
    } else {
      const prevDate = new Date(uniqueDays[i - 1]);
      const currDate = new Date(uniqueDays[i]);
      const diffDays = (prevDate.getTime() - currDate.getTime()) / 86400000;
      if (diffDays <= 1.5) {
        streak++;
      } else {
        if (i <= uniqueDays.indexOf(uniqueDays[0]) + streak) {
          currentStreak = streak;
        }
        longestStreak = Math.max(longestStreak, streak);
        streak = 1;
      }
    }
  }
  currentStreak = currentStreak || streak;
  longestStreak = Math.max(longestStreak, streak);

  return {
    totalFasts,
    completedFasts,
    completionRate,
    currentStreak,
    longestStreak,
    averageDurationMinutes: Math.round(avgDuration),
  };
}
