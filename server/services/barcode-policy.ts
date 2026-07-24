import { valuesMatch } from "../lib/verification-consensus";

// ---------------------------------------------------------------------------
// Pure barcode-lookup policy — no storage, no db, no env reads.
//
// This module exists so operator tooling (scripts/verify-barcode-cache-
// candidates.ts) can import the REAL production policy instead of mirroring
// it: importing barcode-lookup.ts transitively evaluates server/db.ts, which
// throws at module load without DATABASE_URL. Everything here must stay
// importable from a standalone CLI with no environment at all —
// server/services/__tests__/barcode-policy.test.ts enforces that with a
// spawned no-DATABASE_URL import. barcode-lookup.ts re-exports these symbols,
// so existing consumers are unaffected.
// ---------------------------------------------------------------------------

export interface BarcodePer100g {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  saturatedFat?: number; // g
  transFat?: number; // g
  cholesterol?: number; // mg
  caffeine?: number; // mg
}

// Tolerance for the Atwater energy-vs-own-macros corroboration fallback (see
// `offMacrosCorroborateEnergy` below), used only when an OFF entry has no
// per-serving energy to self-check against. Deliberately loose (30%, vs. the
// 15% per-serving ratio check in barcode-lookup.ts): it errs toward SHIELDING an
// identity-matched OFF entry from being overwritten by a name-matched
// secondary — replacement is what corrupts the data (P2-2026-07-22 Nutella
// regression), so a false "consistent" costs far less than a false
// "inconsistent". The 4/4/9 kcal-per-gram approximation also has inherent
// slop of its own (fiber is often counted at 4 rather than 2, sugar alcohols
// vary) that a tight tolerance would misfire on for genuinely correct
// entries. 30% still catches grossly wrong entries — a realistically
// mismatched product's energy is off by 80%+ from its stated macros, not 30%.
export const ATWATER_MACRO_TOLERANCE = 0.3;

/**
 * Atwater energy-vs-own-macros corroboration: does an OFF entry's stated
 * per-100g energy roughly agree with the energy implied by its OWN per-100g
 * macros (4 kcal/g protein + 4 kcal/g carbs + 9 kcal/g fat)? Pure + exported,
 * mirroring `extractOffAllergenData`'s exported+testable style. Used as a
 * fallback self-consistency signal in `offSelfConsistent` when an entry has
 * no per-serving energy to corroborate against (most of OFF) — an entry
 * whose energy agrees with its own macros is self-consistent even without a
 * per-serving field, and must not be replaced by a name/similarity-matched
 * secondary source.
 *
 * Returns false (cannot corroborate) when calories are absent/non-positive —
 * that case is handled by the existing explicit-zero and "missing" branches
 * elsewhere in `offSelfConsistent`, unchanged — or when there are no usable
 * macros to compare against.
 *
 * Fiber is deliberately excluded from the macro sum. OFF aggregates labels
 * from multiple regulatory regimes — EU 1169/2011 ("carbohydrate" EXCLUDES
 * fibre) and US FDA ("Total Carbohydrate" INCLUDES fibre) — and stores
 * whichever was transcribed, so the sign of any per-entry fiber correction is
 * unknowable. Ignoring fiber caps the worst-case error at 2·fiber kcal either
 * way; adding OR subtracting it would be off by 4·fiber for the wrong
 * convention. The 30% tolerance absorbs that residual for all but
 * extreme-fiber products (near-pure psyllium/bran), which stay an accepted
 * unshielded residual rather than be shielded by a convention-guessing term.
 */
export function offMacrosCorroborateEnergy(p: BarcodePer100g): boolean {
  const cal = p.calories;
  if (cal === undefined || cal <= 0) return false;
  const macroKcal =
    4 * (p.protein ?? 0) + 4 * (p.carbs ?? 0) + 9 * (p.fat ?? 0);
  if (macroKcal <= 0) return false;
  return valuesMatch(macroKcal, cal, ATWATER_MACRO_TOLERANCE);
}

/**
 * Compute the UPC-A check digit and return a 12-digit string.
 * Input can be any length ≤ 11; it will be left-padded with zeros.
 */
function computeUPCA(digits: string): string {
  const s = digits.padStart(11, "0");
  let odd = 0,
    even = 0;
  for (let i = 0; i < 11; i++) {
    if (i % 2 === 0) odd += parseInt(s[i]);
    else even += parseInt(s[i]);
  }
  const check = (10 - ((odd * 3 + even) % 10 || 0)) % 10;
  return s + check;
}

/**
 * Compute the EAN-13 check digit and return a 13-digit string.
 * Input can be any length ≤ 12; it will be left-padded with zeros.
 */
function computeEAN13(digits: string): string {
  const s = digits.padStart(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10 || 0)) % 10;
  return s + check;
}

/**
 * Generate barcode padding variants to try on Open Food Facts.
 * Scanners may return different digit counts than what OFF stores
 * (e.g. 10-digit scan vs 12-digit UPC-A vs 13-digit EAN-13).
 */
export function barcodeVariants(code: string): string[] {
  const variants = new Set<string>();
  variants.add(code);

  // Zero-padded variants (no check digit)
  if (code.length < 13) {
    variants.add(code.padStart(12, "0")); // pad to UPC-A length
    variants.add(code.padStart(13, "0")); // pad to EAN-13 length
  }

  // With computed check digits
  if (code.length <= 11) {
    variants.add(computeUPCA(code)); // 12-digit UPC-A with check
  }
  if (code.length <= 12) {
    variants.add(computeEAN13(code)); // 13-digit EAN-13 with check
  }

  return [...variants];
}

/**
 * OFF energy in kcal (per-100g or per-serving fields alike): prefer the kcal
 * field, fall back to the kJ field with OFF's own divisor. `??` (not `||`) so
 * an explicit 0 kcal — a genuine zero-energy product — survives the fallback.
 */
export function offEnergyKcal(
  kcal: number | undefined,
  kj: number | undefined,
): number | undefined {
  return kcal ?? (kj !== undefined ? Math.round(kj / 4.1868) : undefined);
}
