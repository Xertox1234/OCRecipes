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

// ============================================================================
// FASTING PHASES
// ============================================================================

export interface FastingPhase {
  name: string;
  description: string;
  startHour: number;
}

/**
 * Physiological fasting phases ordered by start hour.
 * Each phase's end is implied by the next phase's startHour.
 */
export const FASTING_PHASES: readonly FastingPhase[] = [
  {
    name: "Fed State",
    description:
      "Your body is digesting and absorbing nutrients from your last meal. Insulin levels are elevated.",
    startHour: 0,
  },
  {
    name: "Early Fasting",
    description:
      "Insulin drops and your body begins shifting from glucose to stored energy. Blood sugar stabilizes.",
    startHour: 4,
  },
  {
    name: "Fat Burning",
    description:
      "Glycogen stores deplete and fat oxidation increases. Your body is now primarily burning stored fat for fuel.",
    startHour: 8,
  },
  {
    name: "Ketosis",
    description:
      "Ketone production rises as fat becomes your main energy source. Mental clarity often improves in this phase.",
    startHour: 12,
  },
  {
    name: "Autophagy",
    description:
      "Cells begin recycling damaged components. This cellular cleanup process supports longevity and immune function.",
    startHour: 16,
  },
  {
    name: "Deep Autophagy",
    description:
      "Extended autophagy and cellular renewal. Growth hormone levels may increase significantly.",
    startHour: 24,
  },
];

/** Returns the current fasting phase based on elapsed minutes. */
export function getFastingPhase(elapsedMinutes: number): FastingPhase {
  const hours = elapsedMinutes / 60;
  for (let i = FASTING_PHASES.length - 1; i >= 0; i--) {
    if (hours >= FASTING_PHASES[i].startHour) return FASTING_PHASES[i];
  }
  return FASTING_PHASES[0];
}

/**
 * Returns the next phase boundary in minutes, or null if in the last phase.
 * Derived from FASTING_PHASES array order (no endHour field needed).
 */
export function getNextPhaseBoundary(
  elapsedMinutes: number,
): { phase: FastingPhase; minutes: number } | null {
  const currentPhase = getFastingPhase(elapsedMinutes);
  const currentIdx = FASTING_PHASES.indexOf(currentPhase);
  const nextPhase = FASTING_PHASES[currentIdx + 1];
  if (!nextPhase) return null;
  return { phase: nextPhase, minutes: nextPhase.startHour * 60 };
}

// ============================================================================
// MILESTONE MARKERS
// ============================================================================

export const STANDARD_MILESTONES = [12, 16, 20, 24] as const;

/** Returns milestone hours to display, filtered by target and always including target. */
export function getMilestoneHours(targetHours: number): number[] {
  const milestones = STANDARD_MILESTONES.filter((h) => h <= targetHours);
  if (
    !milestones.includes(targetHours as (typeof STANDARD_MILESTONES)[number])
  ) {
    return [...milestones, targetHours].sort((a, b) => a - b);
  }
  return [...milestones];
}

/** Converts an hour value to an angle on the ring (0 = 12 o'clock position). */
export function milestoneToAngle(hour: number, targetHours: number): number {
  return (hour / targetHours) * 360 - 90;
}

// ============================================================================
// FASTING TIPS (idle state)
// ============================================================================

export interface FastingTip {
  text: string;
  icon: string;
}

export const FASTING_TIPS: readonly FastingTip[] = [
  {
    text: "Stay hydrated \u2014 water, black coffee, and plain tea won't break your fast.",
    icon: "\uD83D\uDCA7",
  },
  {
    text: "Electrolytes (sodium, potassium, magnesium) help prevent headaches during fasts.",
    icon: "\u26A1",
  },
  {
    text: "Hunger comes in waves. It typically passes within 20 minutes.",
    icon: "\uD83C\uDF0A",
  },
  {
    text: "Break your fast with protein and healthy fats to avoid blood sugar spikes.",
    icon: "\uD83E\uDD51",
  },
  {
    text: "Light exercise like walking is safe and can enhance fat burning during a fast.",
    icon: "\uD83D\uDEB6",
  },
  {
    text: "Sleep quality often improves when you stop eating 3+ hours before bedtime.",
    icon: "\uD83D\uDE34",
  },
  {
    text: "Consistent fasting windows help your body adapt and reduce hunger over time.",
    icon: "\uD83D\uDD50",
  },
  {
    text: "Bone broth is a gentle way to break an extended fast (24h+).",
    icon: "\uD83C\uDF75",
  },
];
