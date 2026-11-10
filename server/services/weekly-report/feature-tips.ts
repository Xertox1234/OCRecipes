import {
  FEATURE_TIP_IDS,
  type FeatureTipId,
} from "@shared/schemas/coach-weekly-report";

/** Quiet weeks lead "Try this week" with the easiest ways to log. */
const QUIET_LEAD: FeatureTipId[] = ["photo", "import"];
/** Sorts after every real report index: never shown is the best recency. */
const NEVER_SHOWN = Number.MAX_SAFE_INTEGER;

/**
 * Choose the week's tips. Normal week: one Did-you-know. Quiet week: two
 * "Try this week" tips then one Did-you-know (in that order).
 *
 * Ranking, best first: a feature the user has not used; then the tip shown
 * least recently in `previousTipIds` (newest report first; never shown beats
 * any), so nothing repeats until every unused tip had its turn; then, for the
 * quiet lead slots, photo and import; then catalogue order.
 */
export function pickTips(
  usage: Record<FeatureTipId, boolean>,
  previousTipIds: FeatureTipId[][],
  quiet: boolean,
): FeatureTipId[] {
  const lastShown = (id: FeatureTipId): number => {
    const i = previousTipIds.findIndex((ids) => ids.includes(id));
    return i === -1 ? NEVER_SHOWN : i;
  };

  const rank = (lead: FeatureTipId[]) => (a: FeatureTipId, b: FeatureTipId) => {
    const unused = Number(!usage[b]) - Number(!usage[a]);
    if (unused !== 0) return unused;
    const recency = lastShown(b) - lastShown(a);
    if (recency !== 0) return recency;
    const leadA = lead.indexOf(a);
    const leadB = lead.indexOf(b);
    if (leadA !== leadB) {
      if (leadA === -1) return 1;
      if (leadB === -1) return -1;
      return leadA - leadB;
    }
    return FEATURE_TIP_IDS.indexOf(a) - FEATURE_TIP_IDS.indexOf(b);
  };

  const all = [...FEATURE_TIP_IDS];
  if (!quiet) return [all.sort(rank([]))[0]];

  const tryTips = [...all].sort(rank(QUIET_LEAD)).slice(0, 2);
  const rest = all.filter((id) => !tryTips.includes(id)).sort(rank([]));
  return [...tryTips, rest[0]];
}
