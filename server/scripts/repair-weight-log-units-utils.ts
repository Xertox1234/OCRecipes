/**
 * Pure helpers for the one-off `repair-weight-log-units` script.
 *
 * Extracted so the corruption-classification and reverse-conversion logic can
 * be unit-tested without a database connection (project convention — see
 * `cleanup-seed-recipes-utils.ts`).
 */
import { KG_PER_LB } from "@shared/lib/units";

/**
 * Plausible upper bound for a human body weight in kg. A "restored" value above
 * this almost certainly is not real corruption (or the source row was already
 * garbage) — those rows are flagged `needs-review`, never auto-corrected.
 */
export const MAX_PLAUSIBLE_WEIGHT_KG = 700;

/** A weight_logs row, narrowed to the columns the repair needs. */
export type WeightRow = {
  id: number;
  userId: string;
  /** Current stored value, in kg (the route always writes unit `"kg"`). */
  weight: number;
  /** The row's `unit` column. The buggy route always wrote `"kg"`. */
  unit: string | null;
  source: string | null;
  loggedAt: Date;
};

export type RowClass = "corrupted" | "healthy" | "needs-review";

/**
 * Reverse the kg→lb storage corruption.
 *
 * The write-path bug treated a kg-entered value as pounds and multiplied it by
 * `KG_PER_LB` to "normalise to kg" — so the stored value is `realKg * KG_PER_LB`.
 * Dividing by the same factor is the exact inverse. Result is rounded to 2dp
 * because `weight_logs.weight` is `decimal(6,2)`.
 */
export function restoreKgFromCorrupted(corruptedKg: number): number {
  return Math.round((corruptedKg / KG_PER_LB) * 100) / 100;
}

/** True when a weight (kg) is non-finite, non-positive, or implausibly large. */
export function isImplausibleWeight(kg: number): boolean {
  return !Number.isFinite(kg) || kg <= 0 || kg > MAX_PLAUSIBLE_WEIGHT_KG;
}

/**
 * Classify a single weight_logs row.
 *
 * - `unit !== "kg"` — the buggy route always re-labelled rows to `"kg"`, so a
 *   non-kg row was never touched by this bug. Leave it (`healthy`); reversing it
 *   would corrupt a legitimately-stored value.
 * - `source !== "manual"` (HealthKit / scale) legitimately sent kg — never touch.
 *   `source IS NULL` is treated as manual: the column default is `"manual"`, so a
 *   null is an app/manual row whose source was simply not written explicitly.
 * - A row logged at/after `cutoff` used the fixed client — already correct kg.
 * - A manual, pre-cutoff, kg row is corrupted; but if reversing it yields an
 *   implausible weight, flag `needs-review` instead of writing a bad value.
 */
export function classifyRow(row: WeightRow, cutoff: Date): RowClass {
  if (row.unit !== "kg") return "healthy";
  const isManual = row.source === null || row.source === "manual";
  if (!isManual) return "healthy";
  if (row.loggedAt.getTime() >= cutoff.getTime()) return "healthy";
  return isImplausibleWeight(restoreKgFromCorrupted(row.weight))
    ? "needs-review"
    : "corrupted";
}

/**
 * Parse the required `--cutoff` CLI argument into a Date.
 *
 * The cutoff is the timestamp the forward fix was *deployed* to production —
 * only the operator knows it, so there is no default. Throws on a missing,
 * unparseable, or future value (a future cutoff would mis-classify rows that
 * were correctly stored after the fix as corrupted — see the todo's Risks).
 */
export function parseCutoffArg(
  raw: string | undefined,
  now: Date = new Date(),
): Date {
  if (!raw) {
    throw new Error(
      "--cutoff <ISO-8601 timestamp> is required (the production deploy time of the forward fix)",
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `--cutoff value "${raw}" is not a valid ISO-8601 timestamp`,
    );
  }
  if (parsed.getTime() > now.getTime()) {
    throw new Error(
      `--cutoff value "${raw}" is in the future — a future cutoff would treat ` +
        "already-correct post-fix rows as corrupted. Use the real deploy time.",
    );
  }
  return parsed;
}
