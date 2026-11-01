// Keyword runner for scripts/harness/verdict-diff.sh (harness diagnosis N7).
//
//   plan   <base root> <head root> <rows.json>         keywords read from each version's SOURCE TEXT
//                                                      (CONFLICT_KEYWORDS is not exported), rows generated
//   eval   <root> <rows.json> <out.json> [--sample]    run that version's real functions over the rows
//   report <rows.json> <base.json> <head.json> <head2.json>   compare, check the controls, print lists
//
// eval runs once per version, each in its own process with that version's tsconfig, because the
// @shared alias in allergens.ts can point at only one tree per process.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Module = "diet" | "allergen";
interface Row {
  t: string;
  kw: string;
  mod: string;
  m: Module;
  bare?: true;
}
interface Plan {
  rows: Row[];
  newKw: Record<Module, string[]>;
}

// Food modifiers placed before, after and hyphen-joined to each keyword. Negations and substitute
// words first (the 1491→1499 "free-range" class), then common modifiers. A hand list: the repo held
// no food vocabulary with these words, so this is the weaker half of the generated set.
const MODS = [
  "free",
  "-free",
  "free-range",
  "free range",
  "freeze-dried",
  "free-from",
  "substitute",
  "alternative",
  "imitation",
  "style",
  "flavoured",
  "flavored",
  "extract",
  "powder",
  "oil",
  "less",
  "plant-based",
  "vegan",
  "dairy-free",
  "gluten-free",
  "nut-free",
  "egg",
  "eggs",
  "milk",
  "butter",
  "stock",
  "broth",
  "fresh",
  "frozen",
  "smoked",
  "ground",
  "organic",
  "loaf",
  "pie",
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function quoted(block: string): string[] {
  return [...block.matchAll(/"([^"\n]+)"/g)].map((m) => m[1].toLowerCase());
}
function dietKeywords(root: string): string[] {
  const src = stripComments(
    readFileSync(path.join(root, "shared/constants/diet-conflicts.ts"), "utf8"),
  );
  const start = src.indexOf("const CONFLICT_KEYWORDS");
  const end = src.indexOf("\n};", start);
  if (start < 0 || end < 0)
    throw new Error(`CONFLICT_KEYWORDS block not found in ${root}`);
  const body = src.slice(src.indexOf("{", src.indexOf("=", start)), end);
  return [...new Set(quoted(body))];
}
function allergenKeywords(root: string): string[] {
  const src = stripComments(
    readFileSync(path.join(root, "shared/constants/allergens.ts"), "utf8"),
  );
  const out = new Set<string>();
  for (const m of src.matchAll(
    /(?:directIngredients|derivedIngredients):\s*\[([\s\S]*?)\]/g,
  )) {
    for (const k of quoted(m[1])) out.add(k);
  }
  if (out.size === 0)
    throw new Error(`no allergen keyword arrays found in ${root}`);
  return [...out];
}

function plan(baseRoot: string, headRoot: string, outFile: string): void {
  const kw: Record<Module, { base: string[]; head: string[] }> = {
    diet: { base: dietKeywords(baseRoot), head: dietKeywords(headRoot) },
    allergen: {
      base: allergenKeywords(baseRoot),
      head: allergenKeywords(headRoot),
    },
  };
  const rows: Row[] = [];
  const newKw = { diet: [], allergen: [] } as Record<Module, string[]>;
  for (const m of ["diet", "allergen"] as Module[]) {
    const base = new Set(kw[m].base);
    newKw[m] = kw[m].head.filter((k) => !base.has(k));
    for (const k of [...new Set([...kw[m].base, ...kw[m].head])]) {
      if (kw[m].head.includes(k))
        rows.push({ t: k, kw: k, mod: "(bare)", m, bare: true });
      for (const mod of MODS) {
        const joined = mod.startsWith("-") ? `${k}${mod}` : `${k}-${mod}`;
        for (const t of [`${k} ${mod}`, `${mod} ${k}`, joined])
          rows.push({ t, kw: k, mod, m });
      }
    }
  }
  writeFileSync(outFile, JSON.stringify({ rows, newKw } satisfies Plan));
  console.log(
    `keywords: diet ${kw.diet.base.length}→${kw.diet.head.length} (new: ${newKw.diet.join(", ") || "none"}); ` +
      `allergen ${kw.allergen.base.length}→${kw.allergen.head.length} (new: ${newKw.allergen.length}); rows generated: ${rows.length}`,
  );
}

async function evaluate(
  root: string,
  rowsFile: string,
  outFile: string,
  sample: boolean,
): Promise<void> {
  const { rows } = JSON.parse(readFileSync(rowsFile, "utf8")) as Plan;
  const diet = await import(
    path.join(root, "shared/constants/diet-conflicts.ts")
  );
  const allergens = await import(
    path.join(root, "shared/constants/allergens.ts")
  );
  const everyAllergen = (allergens.allergenIds as readonly string[]).map(
    (name) => ({ name, severity: "severe" as const }),
  );
  const verdict = (r: Row): string => {
    if (r.m === "diet")
      return [...(diet.deriveRecipeDietConflicts([r.t]) ?? [])]
        .sort()
        .join(",");
    const ids = (
      allergens.detectAllergens([r.t], everyAllergen) as {
        allergenId: string;
      }[]
    ).map((x) => x.allergenId);
    return [...new Set(ids)].sort().join(",");
  };
  const out: Record<number, string> = {};
  const step = sample ? 40 : 1;
  for (let i = 0; i < rows.length; i += step) out[i] = verdict(rows[i]);
  writeFileSync(outFile, JSON.stringify(out));
}

function report(
  rowsFile: string,
  baseFile: string,
  headFile: string,
  head2File: string,
): number {
  const { rows, newKw } = JSON.parse(readFileSync(rowsFile, "utf8")) as Plan;
  const base = JSON.parse(readFileSync(baseFile, "utf8")) as Record<
    number,
    string
  >;
  const head = JSON.parse(readFileSync(headFile, "utf8")) as Record<
    number,
    string
  >;
  const head2 = JSON.parse(readFileSync(head2File, "utf8")) as Record<
    number,
    string
  >;
  let failed = false;
  const nb = Object.keys(base).length,
    nh = Object.keys(head).length;
  if (nb !== rows.length || nh !== rows.length) {
    console.log(
      `FAIL: evaluated base ${nb} / head ${nh} of ${rows.length} rows`,
    );
    failed = true;
  }
  const sampled = Object.keys(head2).map(Number);
  const differ = sampled.filter((i) => head2[i] !== head[i]);
  if (differ.length) {
    console.log(
      `FAIL: control (negative): ${differ.length} of ${sampled.length} sampled head rows differ on a second run`,
    );
    failed = true;
  } else
    console.log(
      `control (negative): ${sampled.length} sampled head rows judged twice, 0 differ`,
    );
  const bare = rows.map((r, i) => [r, i] as const).filter(([r]) => r.bare);
  const silent = bare.filter(([, i]) => !head[i]);
  if (silent.length) {
    console.log(
      `FAIL: control (positive): ${silent.length} of ${bare.length} bare keywords flag nothing at head:`,
    );
    for (const [r] of silent) console.log(`    ${r.m}: ${JSON.stringify(r.t)}`);
    failed = true;
  } else
    console.log(
      `control (positive): all ${bare.length} bare keywords flag at head`,
    );

  const group = (
    pick: (r: Row, i: number) => string | null,
  ): [string, string[]][] => {
    const g = new Map<string, string[]>();
    rows.forEach((r, i) => {
      if (r.bare) return;
      const line = pick(r, i);
      if (line === null) return;
      const key = `${r.m} · modifier ${JSON.stringify(r.mod)}`;
      g.set(key, [...(g.get(key) ?? []), line]);
    });
    return [...g.entries()];
  };
  const changed = group((r, i) =>
    base[i] === head[i]
      ? null
      : `${JSON.stringify(r.t).padEnd(30)} [${base[i]}]→[${head[i]}]`,
  );
  console.log(
    `CHANGED (base vs head): ${changed.reduce((n, [, l]) => n + l.length, 0)} of ${rows.length} rows`,
  );
  for (const [k, lines] of changed) {
    console.log(`  ${k} (${lines.length})`);
    for (const l of lines) console.log(`    ${l}`);
  }
  const isNew = (r: Row) => newKw[r.m].includes(r.kw);
  const gaps = group((r, i) =>
    isNew(r) && !head[i] ? JSON.stringify(r.t) : null,
  );
  console.log(
    `GAPS (keywords new at head that flag nothing): ${gaps.reduce((n, [, l]) => n + l.length, 0)}` +
      (newKw.diet.length + newKw.allergen.length === 0
        ? " — no new keywords"
        : ""),
  );
  for (const [k, lines] of gaps)
    console.log(`  ${k} (${lines.length}): ${lines.join(" | ")}`);
  return failed ? 1 : 0;
}

const [mode, a, b, c, d] = process.argv.slice(2);
if (mode === "plan") plan(a, b, c);
else if (mode === "eval") await evaluate(a, b, c, d === "--sample");
else if (mode === "report") process.exitCode = report(a, b, c, d);
else {
  console.error("usage: keywords.ts plan|eval|report …");
  process.exitCode = 2;
}
