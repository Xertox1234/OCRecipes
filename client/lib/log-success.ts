import type { BatchDestination } from "@shared/types/batch-scan";

/**
 * Copy for the "food logged" toast, shared by every log path so the moment
 * reads the same everywhere. Callers pass it to `toast.success(...)`, which
 * fires the Success haptic and announces it — don't add either at the call
 * site (pass `{ haptic: false }` when the site fires its own haptic).
 *
 * `kcal` is the total that was written to the log. Without a usable count the
 * number is dropped rather than shown as "NaN kcal".
 */
export function formatLogSuccess(kcal: number | null | undefined): string {
  if (kcal == null || !Number.isFinite(kcal) || kcal < 0) {
    return "Added to your log";
  }
  return `Added · ${Math.round(kcal)} kcal`;
}

/**
 * Copy for the batch-scan save toast. A daily-log save reads like any other
 * food log, with the total the server records (each item's calories ×
 * quantity, applied via `dailyLogs.servings`). Pantry and grocery saves have
 * no calories to report, so they count items instead.
 */
export function formatBatchSaveSuccess(
  items: readonly { calories: number; quantity: number }[],
  destination: BatchDestination,
  destinationLabel: string,
): string {
  if (destination === "daily_log") {
    return formatLogSuccess(
      items.reduce((sum, item) => sum + item.calories * item.quantity, 0),
    );
  }
  const count = items.length;
  return `${count} item${count !== 1 ? "s" : ""} added to ${destinationLabel}`;
}
