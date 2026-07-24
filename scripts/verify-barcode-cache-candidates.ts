// Classify barcode_nutrition sweep candidates as POISONED vs legitimate.
//
// Usage:  npx tsx scripts/verify-barcode-cache-candidates.ts <barcode>:<cachedKcalPerServing>:<servingGrams> ...
//   or:   npx tsx scripts/verify-barcode-cache-candidates.ts 3017620422003 0018627102588 ...  (verdict from OFF only)
//
// `cachedKcalPerServing` is the `calories` column of barcode_nutrition, which
// stores PER-SERVING values — hence the serving-grams argument needed to
// normalise it to per-100g for comparison against OFF.
//
// Read-only: fetches Open Food Facts, never touches any database — the policy
// functions are imported from the db-free server/services/barcode-policy.ts,
// so the verdicts ARE the server's current shielding policy, not a mirror.
//
// PRECONDITION: every candidate fed to this script is a secondary-source row
// (the sweep SQL filters `source IN ('cnf','usda','api-ninjas')` — see the
// runbook in todos/archive/P2-2026-07-24-barcode-cache-poisoned-rows-
// remediation.md). Under that precondition the verdict criterion is "would
// the current code produce a better row?": a candidate is POISONED when OFF
// resolves it AND the post-fix policy would now shield the entry (macros
// corroborate energy, or it's an explicit zero) — no cached-vs-OFF delta
// threshold, because deleting re-seeds correctly and costs nothing. A
// candidate that no longer resolves in OFF is LEGITIMATE — its secondary
// source was the correct answer (Kinder Bueno).

import { pathToFileURL } from "node:url";

import {
  barcodeVariants,
  offEnergyKcal,
  offMacrosCorroborateEnergy,
} from "../server/services/barcode-policy";

export const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

export const USAGE =
  "usage: npx tsx scripts/verify-barcode-cache-candidates.ts <barcode>[:<cachedKcalPerServing>:<servingGrams>] ...";

export interface Candidate {
  code: string;
  cal: number | null;
  grams: number | null;
}

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
export function parseArgs(args: string[]): {
  candidates: Candidate[];
  errors: string[];
} {
  const candidates: Candidate[] = [];
  const errors: string[] = [];
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

export interface ClassifyInput {
  off100: number | undefined;
  P: number | undefined;
  C: number | undefined;
  F: number | undefined;
  cal: number | null;
  grams: number | null;
}

export interface ClassifyResult {
  shielded: "zero-path" | "yes" | "no";
  cached100: number | "-";
  verdict: string;
}

/**
 * Decide the verdict for one candidate from OFF's per-100g values and the
 * cached per-serving pair. Pure — `cal`/`grams` are the validated numbers from
 * `parseArgs` (or null when the barcode was passed bare), so the division here
 * cannot produce NaN or Infinity.
 */
export function classify({
  off100,
  P,
  C,
  F,
  cal,
  grams,
}: ClassifyInput): ClassifyResult {
  const shielded =
    off100 === 0
      ? "zero-path"
      : offMacrosCorroborateEnergy({
            calories: off100,
            protein: P,
            carbs: C,
            fat: F,
          })
        ? "yes"
        : "no";
  if (cal === null || grams === null) {
    return {
      shielded,
      cached100: "-",
      verdict: shielded !== "no" ? "review (no cached value given)" : "ok",
    };
  }
  const cached100 = Math.round((cal / grams) * 100 * 10) / 10;
  // No calorie-delta threshold: matching numbers are a symptom, not the
  // criterion (the Cherry Coke prod row sat inside every reasonable threshold
  // while carrying another food's macros). Deleting a shielded row costs
  // nothing — it re-seeds from OFF on the next scan — so the bias is toward
  // deleting; cached100 stays in the output as informational context only.
  return {
    shielded,
    cached100,
    verdict: off100 !== undefined && shielded !== "no" ? "POISONED" : "ok",
  };
}

export interface OffProduct {
  product_name?: string;
  nutriments?: Record<string, unknown>;
}

/**
 * Minimal structural fetch type so tests can inject a fake without dragging
 * in full DOM Response typing; the global `fetch` satisfies it.
 */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ json(): Promise<unknown> }>;

export interface SweepDeps {
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Resolve a barcode against OFF exactly the way production does
 * (lookupBarcode): try every padding/check-digit variant in order, first
 * `status === 1` hit wins, and a per-variant fetch error is recorded but does
 * not stop the loop. Errors only matter when NOTHING resolves — the caller
 * must treat that as "unchecked", never as "(not in OFF)".
 */
export async function resolveOffProduct(
  code: string,
  deps: SweepDeps = {},
): Promise<{
  product: OffProduct | null;
  matchedVariant?: string;
  errors: string[];
}> {
  const fetchImpl = deps.fetchImpl ?? (fetch as FetchLike);
  const errors: string[] = [];
  for (const variant of barcodeVariants(code)) {
    try {
      const r = await fetchImpl(
        `https://world.openfoodfacts.org/api/v0/product/${variant}.json`,
        { signal: AbortSignal.timeout(20000) },
      );
      const j = (await r.json()) as { status?: number; product?: OffProduct };
      if (j.status === 1 && j.product) {
        return { product: j.product, matchedVariant: variant, errors };
      }
    } catch (e) {
      errors.push(`${variant}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { product: null, errors };
}

async function main(argv: string[]): Promise<number> {
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

  const rows: Record<string, unknown>[] = [];
  for (const { code, cal: cachedServCal, grams: servG } of candidates) {
    const { product: p, errors } = await resolveOffProduct(code);
    // Coverage soundness: a barcode whose variants ERRORED (vs cleanly
    // missed) was never actually checked — it must surface as unchecked,
    // never as "(not in OFF)" → LEGITIMATE.
    if (!p && errors.length > 0) {
      rows.push({
        barcode: code,
        verdict: "FETCH ERROR — recheck",
        note: errors.join("; "),
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
    const nm = p.nutriments ?? {};
    const off100 = offEnergyKcal(
      num(nm["energy-kcal_100g"]),
      num(nm.energy_100g),
    );
    const { shielded, cached100, verdict } = classify({
      off100,
      P: num(nm.proteins_100g),
      C: num(nm.carbohydrates_100g),
      F: num(nm.fat_100g),
      cal: cachedServCal,
      grams: servG,
    });

    rows.push({
      barcode: code,
      product: (p.product_name ?? "").slice(0, 22),
      cached_kcal100: cached100,
      off_kcal100: off100 ?? "-",
      shielded_now: shielded,
      verdict,
    });
    await new Promise((r) => setTimeout(r, 900));
  }

  console.table(rows);
  const poisoned = rows
    .filter((r) => r.verdict === "POISONED")
    .map((r) => r.barcode as string);
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
  void (async () => {
    process.exit(await main(process.argv.slice(2)));
  })();
}
