// Classify barcode_nutrition sweep candidates as POISONED vs legitimate.
//
// Usage:  node scripts/verify-barcode-cache-candidates.mjs <barcode>:<cachedKcalPerServing>:<servingGrams> ...
//   or:   node scripts/verify-barcode-cache-candidates.mjs 3017620422003 0018627102588 ...  (verdict from OFF only)
//
// `cachedKcalPerServing` is the `calories` column of barcode_nutrition, which
// stores PER-SERVING values — hence the serving-grams argument needed to
// normalise it to per-100g for comparison against OFF.
//
// Read-only: fetches Open Food Facts, never touches any database.
// A candidate is POISONED when OFF resolves it AND the post-fix policy would now
// shield that entry (macros corroborate energy, or it's an explicit zero) AND the
// cached value differs materially from OFF. A candidate that no longer resolves in
// OFF is LEGITIMATE — its secondary source was the correct answer (Kinder Bueno).

import { pathToFileURL } from "node:url";

export const num = (v) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

// Mirrors server/lib/verification-consensus.ts valuesMatch
export function valuesMatch(a, b, tol) {
  if (a === b) return true;
  if (Math.abs(a) < 2 && Math.abs(b) < 2) return Math.abs(a - b) <= 1;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

// Mirrors offMacrosCorroborateEnergy (server/services/barcode-lookup.ts), 0.3 tolerance
export function corroborates(cal, P, C, F) {
  if (cal === undefined || cal <= 0) return false;
  const macroKcal = 4 * (P ?? 0) + 4 * (C ?? 0) + 9 * (F ?? 0);
  if (macroKcal <= 0) return false;
  return valuesMatch(macroKcal, cal, 0.3);
}

/** OFF per-100g energy, preferring kcal and falling back to the kJ field. */
export function offPer100gCalories(nm) {
  return (
    num(nm["energy-kcal_100g"]) ??
    (num(nm.energy_100g) !== undefined
      ? Math.round(nm.energy_100g / 4.1868)
      : undefined)
  );
}

export const USAGE =
  "usage: node scripts/verify-barcode-cache-candidates.mjs <barcode>[:<cachedKcalPerServing>:<servingGrams>] ...";

/**
 * Parse and validate every argument BEFORE any network call.
 *
 * This has to fail loudly rather than fall through: the numbers here feed the
 * POISONED/ok verdict an operator turns into a DELETE, and JS coercion hides
 * bad input in BOTH directions — `Number("abc")` is NaN and every comparison
 * against it is false, so a typo'd grams value silently reported `ok` and a
 * poisoned row got skipped; `Number("0")` divides to Infinity and `Number("")`
 * is 0, either of which reports POISONED for a row nobody actually checked.
 * Neither surfaced as an error. Validating up front also means a malformed
 * batch costs zero OFF requests.
 */
export function parseArgs(args) {
  const candidates = [];
  const errors = [];
  for (const arg of args) {
    const parts = arg.split(":");
    const [code, rawCal, rawGrams] = parts;
    if (!/^\d+$/.test(code ?? "")) {
      errors.push(`"${arg}": barcode must be digits only`);
      continue;
    }
    if (parts.length === 1) {
      candidates.push({ code, cal: null, grams: null });
      continue;
    }
    if (parts.length !== 3) {
      errors.push(
        `"${arg}": expected <barcode> or <barcode>:<cachedKcalPerServing>:<servingGrams>`,
      );
      continue;
    }
    const cal = Number(rawCal);
    const grams = Number(rawGrams);
    if (rawCal.trim() === "" || !Number.isFinite(cal) || cal < 0) {
      errors.push(`"${arg}": cachedKcalPerServing must be a number >= 0`);
      continue;
    }
    if (rawGrams.trim() === "" || !Number.isFinite(grams) || grams <= 0) {
      errors.push(`"${arg}": servingGrams must be a number > 0`);
      continue;
    }
    candidates.push({ code, cal, grams });
  }
  return { candidates, errors };
}

/**
 * Decide the verdict for one candidate from OFF's per-100g values and the
 * cached per-serving pair. Pure — `cal`/`grams` are the validated numbers from
 * `parseArgs` (or null when the barcode was passed bare), so the division here
 * cannot produce NaN or Infinity.
 */
export function classify({ off100, P, C, F, cal, grams }) {
  const shielded =
    off100 === 0 ? "zero-path" : corroborates(off100, P, C, F) ? "yes" : "no";
  if (cal === null || grams === null) {
    return {
      shielded,
      cached100: "-",
      verdict: shielded !== "no" ? "review (no cached value given)" : "ok",
    };
  }
  const cached100 = Math.round((cal / grams) * 100 * 10) / 10;
  const materially =
    off100 !== undefined &&
    Math.abs(cached100 - off100) > Math.max(5, off100 * 0.25);
  return {
    shielded,
    cached100,
    verdict: materially && shielded !== "no" ? "POISONED" : "ok",
  };
}

async function main(argv) {
  if (argv.length === 0) {
    console.error(USAGE);
    return 1;
  }
  const { candidates, errors: argErrors } = parseArgs(argv);
  if (argErrors.length > 0) {
    console.error("Invalid arguments — nothing was checked:");
    for (const e of argErrors) console.error(`  ${e}`);
    console.error(`\n${USAGE}`);
    return 1;
  }

  const rows = [];
  for (const { code, cal: cachedServCal, grams: servG } of candidates) {
    let p = null;
    try {
      const r = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
        { signal: AbortSignal.timeout(20000) },
      );
      const j = await r.json();
      if (j.status === 1 && j.product) p = j.product;
    } catch (e) {
      rows.push({
        barcode: code,
        verdict: "FETCH ERROR — recheck",
        note: e.message,
      });
      continue;
    }
    if (!p) {
      rows.push({
        barcode: code,
        product: "(not in OFF)",
        verdict: "LEGITIMATE",
        note: "no OFF product — the secondary source is correct; do NOT delete",
      });
      await new Promise((r) => setTimeout(r, 900));
      continue;
    }
    const nm = p.nutriments || {};
    const { shielded, cached100, verdict } = classify({
      off100: offPer100gCalories(nm),
      P: num(nm.proteins_100g),
      C: num(nm.carbohydrates_100g),
      F: num(nm.fat_100g),
      cal: cachedServCal,
      grams: servG,
    });

    rows.push({
      barcode: code,
      product: (p.product_name || "").slice(0, 22),
      cached_kcal100: cached100,
      off_kcal100: offPer100gCalories(nm) ?? "-",
      shielded_now: shielded,
      verdict,
    });
    await new Promise((r) => setTimeout(r, 900));
  }

  console.table(rows);
  const poisoned = rows
    .filter((r) => r.verdict === "POISONED")
    .map((r) => r.barcode);
  console.log(`\nPOISONED: ${poisoned.length} of ${rows.length}`);
  if (poisoned.length) {
    console.log(
      `\nDELETE FROM barcode_nutrition WHERE barcode IN (${poisoned.map((b) => `'${b}'`).join(",")});`,
    );
  }
  return 0;
}

// Only run the CLI when invoked directly — importing this module (e.g. from the
// test suite) must not fire off network requests or call process.exit.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(await main(process.argv.slice(2)));
}
