// ── Title Case ──────────────────────────────────────────────────────────────

const LOWERCASE_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "but",
  "or",
  "for",
  "nor",
  "on",
  "at",
  "to",
  "in",
  "of",
  "with",
  "by",
  "from",
]);

export function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return trimmed;
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) =>
      i === 0 || !LOWERCASE_WORDS.has(word)
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word,
    )
    .join(" ");
}

// ── Description ─────────────────────────────────────────────────────────────

export function normalizeDescription(
  desc: string | null | undefined,
): string | null {
  if (!desc || !desc.trim()) return null;
  let result = desc.trim();
  result = result.charAt(0).toUpperCase() + result.slice(1);
  if (!/[.!?]$/.test(result)) {
    result += ".";
  }
  return result;
}

// ── Difficulty ──────────────────────────────────────────────────────────────

const DIFFICULTY_MAP: Record<string, string> = {
  easy: "Easy",
  simple: "Easy",
  beginner: "Easy",
  medium: "Medium",
  moderate: "Medium",
  intermediate: "Medium",
  hard: "Hard",
  difficult: "Hard",
  advanced: "Hard",
  expert: "Hard",
};

export function normalizeDifficulty(
  difficulty: string | null | undefined,
): string | null {
  if (!difficulty) return null;
  return DIFFICULTY_MAP[difficulty.toLowerCase().trim()] ?? null;
}

// ── Instructions ────────────────────────────────────────────────────────────

const STEP_PREFIX_RE = /^\s*(?:\d+[.)]\s*|step\s+\d+[:.]\s*)/i;

export function normalizeInstructions(
  instructions: string[] | null | undefined,
): string[] {
  if (!instructions) return [];
  return instructions
    .map((step) => step.replace(STEP_PREFIX_RE, "").trim())
    .filter((step) => step.length > 0)
    .map((step) => step.charAt(0).toUpperCase() + step.slice(1));
}

// ── Units ───────────────────────────────────────────────────────────────────

const UNIT_MAP: Record<string, string> = {
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tbsp: "tbsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tsp: "tsp",
  ounce: "oz",
  ounces: "oz",
  oz: "oz",
  pound: "lb",
  pounds: "lb",
  lb: "lb",
  lbs: "lb",
  cup: "cup",
  cups: "cup",
  gram: "g",
  grams: "g",
  g: "g",
  kilogram: "kg",
  kilograms: "kg",
  kg: "kg",
  milliliter: "ml",
  milliliters: "ml",
  ml: "ml",
  liter: "l",
  liters: "l",
  l: "l",
};

export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "";
  const lower = unit.toLowerCase().trim();
  return UNIT_MAP[lower] ?? lower;
}

// ── Ingredients ─────────────────────────────────────────────────────────────

const MEASUREMENT_RE =
  /^(\d+(?:\/\d+)?(?:\.\d+)?)\s+(tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|cups?|grams?|g|kg|ml|l)\s+(.+)$/i;

export interface IngredientInput {
  name: string;
  quantity: string;
  unit: string;
}

export function normalizeIngredient(ing: IngredientInput): IngredientInput {
  let { name, quantity, unit } = ing;

  // If quantity is empty, try to extract measurement from the name field
  if (!quantity.trim() && !unit.trim()) {
    const match = name.match(MEASUREMENT_RE);
    if (match) {
      quantity = match[1];
      unit = match[2];
      name = match[3];
    }
  }

  return {
    name: normalizeTitle(name),
    quantity: quantity.trim(),
    unit: normalizeUnit(unit),
  };
}
