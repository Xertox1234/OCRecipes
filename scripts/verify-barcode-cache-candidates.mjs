// Classify barcode_nutrition sweep candidates as POISONED vs legitimate.
//
// Usage:  node verify-candidates.mjs <barcode>[:<cachedKcalPerServing>:<servingGrams>] ...
//   or:   node verify-candidates.mjs 3017620422003 0018627102588 ...   (verdict from OFF only)
//
// Read-only: fetches Open Food Facts, never touches any database.
// A candidate is POISONED when OFF resolves it AND the post-fix policy would now
// shield that entry (macros corroborate energy, or it's an explicit zero) AND the
// cached value differs materially from OFF. A candidate that no longer resolves in
// OFF is LEGITIMATE — its secondary source was the correct answer (Kinder Bueno).

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

// Mirrors server/lib/verification-consensus.ts valuesMatch
function valuesMatch(a, b, tol) {
  if (a === b) return true;
  if (Math.abs(a) < 2 && Math.abs(b) < 2) return Math.abs(a - b) <= 1;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= tol;
}

// Mirrors offMacrosCorroborateEnergy (server/services/barcode-lookup.ts), 0.3 tolerance
function corroborates(cal, P, C, F) {
  if (cal === undefined || cal <= 0) return false;
  const macroKcal = 4 * (P ?? 0) + 4 * (C ?? 0) + 9 * (F ?? 0);
  if (macroKcal <= 0) return false;
  return valuesMatch(macroKcal, cal, 0.3);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node verify-candidates.mjs <barcode>[:<cachedKcal>:<servingG>] ...");
  process.exit(1);
}

const rows = [];
for (const arg of args) {
  const [code, cachedServCal, servG] = arg.split(":");
  let p = null;
  try {
    const r = await fetch(
      `https://world.openfoodfacts.org/api/v0/product/${code}.json`,
      { signal: AbortSignal.timeout(20000) },
    );
    const j = await r.json();
    if (j.status === 1 && j.product) p = j.product;
  } catch (e) {
    rows.push({ barcode: code, verdict: "FETCH ERROR — recheck", note: e.message });
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
  const off100 =
    num(nm["energy-kcal_100g"]) ??
    (num(nm.energy_100g) !== undefined ? Math.round(nm.energy_100g / 4.1868) : undefined);
  const P = num(nm.proteins_100g), C = num(nm.carbohydrates_100g), F = num(nm.fat_100g);
  const shielded = off100 === 0 ? "zero-path" : corroborates(off100, P, C, F) ? "yes" : "no";

  let cached100, verdict;
  if (cachedServCal !== undefined && servG !== undefined) {
    cached100 = Math.round((Number(cachedServCal) / Number(servG)) * 100 * 10) / 10;
    const materially =
      off100 !== undefined &&
      Math.abs(cached100 - off100) > Math.max(5, off100 * 0.25);
    verdict = materially && shielded !== "no" ? "POISONED" : "ok";
  } else {
    cached100 = "-";
    verdict = shielded !== "no" ? "review (no cached value given)" : "ok";
  }

  rows.push({
    barcode: code,
    product: (p.product_name || "").slice(0, 22),
    cached_kcal100: cached100,
    off_kcal100: off100 ?? "-",
    shielded_now: shielded,
    verdict,
  });
  await new Promise((r) => setTimeout(r, 900));
}

console.table(rows);
const poisoned = rows.filter((r) => r.verdict === "POISONED").map((r) => r.barcode);
console.log(`\nPOISONED: ${poisoned.length} of ${rows.length}`);
if (poisoned.length) {
  console.log(
    `\nDELETE FROM barcode_nutrition WHERE barcode IN (${poisoned.map((b) => `'${b}'`).join(",")});`,
  );
}
