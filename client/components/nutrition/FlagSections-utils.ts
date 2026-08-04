/**
 * Which universal flags "Heads up" still has to say. Pure, no React.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A badge is dropped only when `NutritionPanel` is ACTUALLY BANDING that
 * nutrient — never merely because the panel covers it. The two diverge on a
 * reachable scan-path state, and the difference is a health warning the user
 * does or does not see:
 *
 *   - `server/routes/nutrition.ts` omits `isBeverage` entirely when a product
 *     carries no category tags (deliberately — "absent → fall back to the
 *     parsed serving unit, never default to food"), and the client maps that
 *     to `null`.
 *   - `client/lib/serving-size-utils.ts` falls back to the literal
 *     `"1 serving"` when a record has no usable serving string, and OFF
 *     free-text servings ("1 bottle") pass through verbatim. Neither parses.
 *
 * Those two gaps are CORRELATED — a sparse OFF record typically lacks both —
 * and together they make `resolveBasis` return `{ kind: "unknown" }`, so every
 * band is `unknown` and the panel paints no indicator at all. Meanwhile
 * `server/services/universal-flags.ts` still emits food-scale `nutrient:*`
 * flags for the same product, because `isBeverageCategory([])` is `false`. An
 * "owns the nutrient" filter deletes the server's `severity: "warn"` badge and
 * puts nothing in its place: the panel shows `39 g` with no dot, and the
 * warning the pre-2c screen displayed is simply gone.
 *
 * Per nutrient, not all-or-nothing: if sugar bands and sodium does not, only
 * sugar's badge goes.
 */
import type {
  NutrientBands,
  ConcernNutrient,
} from "@shared/lib/nutrition-bands";
import type { ScanFlag, NutrientKind } from "@shared/types/scan-flags";

/**
 * The snake_case → camelCase bridge, and the reason this table is explicit
 * rather than a cast: `ScanFlag.nutrient` is a `NutrientKind`
 * (`shared/types/scan-flags.ts` — `saturated_fat`) while the band layer's
 * `ConcernNutrient` is camelCase (`saturatedFat`). This is the same shape as
 * `NUTRIENT_ROWS.sourceKey` bridging `fibre`/`fiber`.
 *
 * A mismatch here fails SILENTLY and in the direction that looks harmless:
 * `saturated_fat` would never be found among the bands, so its badge would
 * always survive — which reads as "cautious" but actually means the mapping is
 * dead and only sugar and sodium (spelled identically in both unions) are
 * protected at all. `saturated_fat` is therefore the only key that can prove
 * this table is alive, and a test names it specifically.
 *
 * A full `Record`, not a `Partial`: a new `NutrientKind` must be a compile
 * error AT THIS TABLE rather than an absent key nobody notices. `null` means
 * "the panel publishes no band for this nutrient", which is true of caffeine —
 * its panel row is unbanded (value only), so its badge is the ONLY thing that
 * can warn about it and must never be dropped.
 */
const CONCERN_NUTRIENT_BY_KIND: Record<NutrientKind, ConcernNutrient | null> = {
  sugar: "sugar",
  saturated_fat: "saturatedFat",
  sodium: "sodium",
  caffeine: null,
};

/**
 * True when the panel is showing a real traffic-light judgement for this
 * flag's nutrient — the only condition under which the badge is redundant.
 *
 * `band === "unknown"` is NOT a band: `concernBand` returns it both for an
 * absent value and for an unresolvable basis, and the panel renders neither a
 * dot nor a tag for it. Treating it as "banded" is exactly the bug this
 * module exists to prevent.
 */
export function isBandedByPanel(flag: ScanFlag, bands: NutrientBands): boolean {
  if (!flag.nutrient) return false;
  const nutrient = CONCERN_NUTRIENT_BY_KIND[flag.nutrient];
  if (nutrient === null) return false;
  const entry = bands.concerns[nutrient];
  return entry !== undefined && entry.band !== "unknown";
}

/**
 * The universal flags "Heads up" must still render: everything the panel is
 * not already banding, in the caller's order.
 *
 * The six-flag cap stays at the call site — it is a display decision about how
 * many badges fit, independent of which badges are still needed.
 */
export function dropPanelBandedFlags(
  universal: ScanFlag[],
  bands: NutrientBands,
): ScanFlag[] {
  return universal.filter((flag) => !isBandedByPanel(flag, bands));
}
