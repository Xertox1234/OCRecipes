interface ParsedFrontLabel {
  brand: string | null;
  productName: string | null;
  netWeight: string | null;
  claims: string[];
  confidence: number;
}

const WEIGHT_RE = /\b(\d+(?:\.\d+)?)\s*(g|oz|ml|fl\s?oz|lb|kg|l)\b/i;

// Each entry: [search-substring (lowercase), display label]
const CLAIM_MAP: [string, string][] = [
  ["high protein", "High Protein"],
  ["no sugar added", "No Sugar Added"],
  ["gluten-free", "Gluten Free"],
  ["gluten free", "Gluten Free"],
  ["certified organic", "Certified Organic"],
  ["non-gmo", "Non-GMO"],
  ["non gmo", "Non-GMO"],
  ["keto friendly", "Keto Friendly"],
  ["keto", "Keto"],
  ["whole grain", "Whole Grain"],
  ["low fat", "Low Fat"],
  ["fat free", "Fat Free"],
  ["sugar-free", "Sugar Free"],
  ["sugar free", "Sugar Free"],
  ["vegan", "Vegan"],
  ["vegetarian", "Vegetarian"],
  ["grass-fed", "Grass Fed"],
  ["grass fed", "Grass Fed"],
  ["cage-free", "Cage Free"],
  ["cage free", "Cage Free"],
  ["dairy-free", "Dairy Free"],
  ["dairy free", "Dairy Free"],
  ["plant-based", "Plant Based"],
  ["plant based", "Plant Based"],
  ["organic", "Organic"],
];

function extractNetWeight(line: string): string | null {
  const m = WEIGHT_RE.exec(line);
  return m ? m[0].trim() : null;
}

function matchesClaim(line: string): string | null {
  const lower = line.toLowerCase().trim();
  for (const [kw, display] of CLAIM_MAP) {
    if (lower.includes(kw)) return display;
  }
  return null;
}

function isAllCaps(text: string): boolean {
  return /^[A-Z][A-Z0-9\s&'-]*$/.test(text) && /[A-Z]/.test(text);
}

function isTitleCase(text: string): boolean {
  const words = text.trim().split(/\s+/);
  return words.every((w) => /^[A-Z&]/.test(w));
}

function couldBeBrand(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || /\d/.test(trimmed)) return false;
  if (matchesClaim(trimmed)) return false;
  if (extractNetWeight(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  if (!trimmed.match(/[a-zA-Z]{2,}/)) return false;
  return isAllCaps(trimmed) || isTitleCase(trimmed);
}

export function parseFrontLabelFromOCR(text: string): ParsedFrontLabel {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let brand: string | null = null;
  let netWeight: string | null = null;
  const claimSet = new Set<string>();
  const candidateProductLines: string[] = [];

  for (const line of lines) {
    const weight = extractNetWeight(line);
    if (weight) {
      if (!netWeight) netWeight = weight;
      continue;
    }

    const claim = matchesClaim(line);
    if (claim) {
      claimSet.add(claim);
      continue;
    }

    if (!brand && couldBeBrand(line)) {
      brand = line.trim();
      continue;
    }

    // Only accept lines with real alpha content as product name candidates
    if (line.match(/[a-zA-Z]{2,}/)) {
      candidateProductLines.push(line.trim());
    }
  }

  const productName =
    candidateProductLines.length > 0
      ? candidateProductLines.reduce((a, b) => (a.length >= b.length ? a : b))
      : null;

  const claims = Array.from(claimSet);

  const confidence =
    0.25 * (brand ? 1 : 0) +
    0.25 * (productName ? 1 : 0) +
    0.25 * (netWeight ? 1 : 0) +
    0.25 * Math.min(1, claims.length / 2);

  return { brand, productName, netWeight, claims, confidence };
}
