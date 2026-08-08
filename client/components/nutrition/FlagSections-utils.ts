/**
 * Which universal flags "Heads up" still has to say. Pure, no React.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────
 * A badge is dropped only when the panel GENUINELY REPLACES it — never merely
 * because the panel covers the nutrient, and never merely because the panel
 * resolved *some* band for it. Two independent gaps make those three readings
 * diverge, and in both the difference is a health warning the user does or
 * does not see.
 *
 * GAP 1 — the panel may band NOTHING at all. `server/routes/nutrition.ts`
 * omits `isBeverage` entirely when a product carries no category tags
 * (deliberately — "absent → fall back to the parsed serving unit, never
 * default to food"), and the client maps that to `null`. Separately,
 * `client/lib/serving-size-utils.ts` falls back to the literal `"1 serving"`
 * when a record has no usable serving string, and OFF free-text servings
 * ("1 bottle") pass through verbatim. Neither parses. Those two gaps are
 * CORRELATED — a sparse OFF record typically lacks both — and together they
 * make `resolveBasis` return `{ kind: "unknown" }`, so every band is `unknown`
 * and the panel paints no indicator at all. Meanwhile
 * `server/services/universal-flags.ts` still emits food-scale `nutrient:*`
 * flags for the same product, because `isBeverageCategory([])` is `false`. An
 * "owns the nutrient" filter deletes the server's `severity: "warn"` badge and
 * puts nothing in its place: the panel shows `39 g` with no dot, and the
 * warning the pre-2c screen displayed is simply gone.
 *
 * GAP 2 — the panel may band the nutrient and still be saying something
 * WEAKER than the badge. The panel is serving-invariant by design and passes
 * no `portionGrams` to `concernBand` (`nutrition-band-source.ts`), so it can
 * never reproduce the FSA per-PORTION override the server applies in
 * `high()`'s second clause (`server/services/universal-flags.ts:55-70`:
 * `servingGrams > 100 && perServing > FSA_PORTION[n]`). That clause fires on
 * real records — `server/routes/nutrition.ts:99-107` populates `perServing`
 * whenever `isServingDataTrusted`, and `server/services/label-override.ts:190-191`
 * sets serving-trusted expressly so the per-portion path runs. Cherry Coke,
 * the flagship Trust-the-Label product, is exactly this shape: 39 g sugar in a
 * 355 mL can bands MEDIUM per-100 (10.99 vs `FSA_DRINK.sugar.high` 11.25) while
 * the server emits "High in sugar". A larger food portion inverts the colour
 * outright — 700 g at 4 g/100 g is a server HIGH against a panel LOW, i.e. a
 * green check dot and a "LOW" pill standing where the red warning was.
 *
 * So the test is AGREEMENT, not existence: a `warn`/`danger` nutrient badge
 * survives unless the panel's own band is `high`. An `info`-severity badge
 * makes no severity claim of its own, so any resolved band supersedes it.
 *
 * This cannot over-keep: there is no badge to keep unless the server emitted
 * one, and the common case (per-100 over the line → server HIGH → panel HIGH)
 * still dedups.
 *
 * Per nutrient, not all-or-nothing: if sugar agrees and sodium does not, only
 * sugar's badge goes.
 */
import type {
  NutrientBands,
  ConcernNutrient,
} from "@shared/lib/nutrition-bands";
import type {
  ScanFlag,
  NutrientKind,
  ScanFlagSeverity,
} from "@shared/types/scan-flags";

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
 * Whether the panel's band has to AGREE with the badge, or merely exist.
 *
 * A `warn`/`danger` nutrient badge asserts a specific severity ("High in X"),
 * and only the panel's own `high` band asserts the same thing — see GAP 2 in
 * the module docblock for the two ways a weaker band arises on real records.
 * An `info` badge asserts nothing beyond presence, so any resolved band is a
 * strictly richer statement and the badge is redundant.
 *
 * A `Record` over the real severity union rather than a `!== "info"` test, so
 * a new `ScanFlagSeverity` is a compile error AT THIS TABLE rather than
 * silently inheriting the strict branch. No live emitter produces an `info`
 * nutrient flag that reaches here today: `evaluateUniversalFlags` ships every
 * `high()` flag as `warn`, and its one `info` nutrient flag ("Contains
 * caffeine") maps to `null` above and returns earlier.
 */
const REQUIRES_BAND_AGREEMENT: Record<ScanFlagSeverity, boolean> = {
  danger: true,
  warn: true,
  info: false,
};

/**
 * True when the panel's traffic light genuinely REPLACES this badge — the only
 * condition under which dropping it loses nothing.
 *
 * `band === "unknown"` is NOT a band: `concernBand` returns it both for an
 * absent value and for an unresolvable basis, and the panel renders neither a
 * dot nor a tag for it. Treating it as "banded" is exactly the bug this
 * module exists to prevent. The guard is load-bearing on the `info` branch
 * only — on the strict branch `"unknown" !== "high"` already rejects it — and
 * a test names that branch specifically so the guard cannot be deleted as
 * "subsumed".
 */
export function isBandedByPanel(flag: ScanFlag, bands: NutrientBands): boolean {
  if (!flag.nutrient) return false;
  const nutrient = CONCERN_NUTRIENT_BY_KIND[flag.nutrient];
  if (nutrient === null) return false;
  const entry = bands.concerns[nutrient];
  if (entry === undefined || entry.band === "unknown") return false;
  return REQUIRES_BAND_AGREEMENT[flag.severity] ? entry.band === "high" : true;
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
