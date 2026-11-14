/**
 * What a screen reader hears when the batch's item lookups finish: spoken
 * only on the pending → settled edge (prevPending > 0, pending === 0), never
 * on mount or while items are still loading. The per-item spinners and the
 * confirm button's changing label are not announced on their own.
 */
export function getBatchSettledAnnouncement(
  prevPending: number,
  pending: number,
  unverifiedCount: number,
): string | null {
  if (prevPending === 0 || pending > 0) return null;
  if (unverifiedCount === 0) return "All items loaded.";
  return `All items loaded. ${unverifiedCount} item${unverifiedCount === 1 ? "" : "s"} couldn't be found.`;
}
