/**
 * The coach's mood score (visible memory spec 2026-11-08): one number per
 * user, nudged by each Coach Pro turn, decaying back toward neutral so one bad
 * day fades. It only shapes how the coach approaches things — never shown,
 * never said out loud; the prompt gets a coarse band.
 */
export type MoodBand = "low" | "neutral" | "good";

const HALF_LIFE_DAYS = 3;
const MIN = -2;
const MAX = 2;
const BAND_EDGE = 0.75;

export function decayedMood(
  score: number,
  updatedAt: Date | null,
  now: Date,
): number {
  if (!updatedAt) return score;
  const days = (now.getTime() - updatedAt.getTime()) / 86_400_000;
  if (days <= 0) return score;
  return score * 0.5 ** (days / HALF_LIFE_DAYS);
}

export function applyMoodDelta(
  score: number,
  updatedAt: Date | null,
  delta: number,
  now: Date,
): number {
  const next = decayedMood(score, updatedAt, now) + delta;
  return Math.min(MAX, Math.max(MIN, next));
}

export function moodBand(score: number): MoodBand {
  if (score < -BAND_EDGE) return "low";
  if (score > BAND_EDGE) return "good";
  return "neutral";
}
