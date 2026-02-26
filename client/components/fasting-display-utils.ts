/**
 * Pure display utilities for FastingTimer and FastingStreakBadge.
 * Extracted for testability — no React dependencies.
 */

/** Fasting progress clamped to [0, 1]. */
export function calculateFastingProgress(
  elapsedMinutes: number,
  targetMinutes: number,
): number {
  if (targetMinutes <= 0) return 0;
  return Math.min(elapsedMinutes / targetMinutes, 1);
}

interface TimeDisplay {
  main: string;
  label: string;
}

/**
 * Formats fasting time display.
 * - Before target: shows "HH:MM" remaining
 * - After target: shows "+HH:MM" past target
 */
export function formatFastingTimeDisplay(
  elapsedMinutes: number,
  targetMinutes: number,
): TimeDisplay {
  const isComplete = elapsedMinutes >= targetMinutes;

  if (isComplete) {
    const overMinutes = elapsedMinutes - targetMinutes;
    const overHours = Math.floor(overMinutes / 60);
    const overMins = Math.floor(overMinutes % 60);
    return {
      main: `+${String(overHours).padStart(2, "0")}:${String(overMins).padStart(2, "0")}`,
      label: "Past target",
    };
  }

  const remainingMinutes = Math.max(targetMinutes - elapsedMinutes, 0);
  const hours = Math.floor(remainingMinutes / 60);
  const mins = Math.floor(remainingMinutes % 60);
  return {
    main: `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
    label: "Remaining",
  };
}

/**
 * Streak label with correct pluralization.
 * Returns null for streak <= 0 (badge should not render).
 */
export function formatStreakLabel(streak: number): string | null {
  if (streak <= 0) return null;
  return `${streak} day${streak !== 1 ? "s" : ""}`;
}

/** Whether the streak badge should use the "high streak" color (>= 7 days). */
export function isHighStreak(streak: number): boolean {
  return streak >= 7;
}
