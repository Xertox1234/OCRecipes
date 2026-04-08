/**
 * Pure function parser that extracts structured nutrition data from OCR text.
 * Designed for US nutrition labels in English. Uses line-by-line regex matching
 * with common OCR misread correction.
 */

export interface LocalNutritionData {
  calories: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  transFat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  totalCarbs: number | null;
  dietaryFiber: number | null;
  totalSugars: number | null;
  protein: number | null;
  servingSize: string | null;
  confidence: number;
}

/** Fix common OCR character misreads in numeric strings */
function fixOCRDigits(s: string): string {
  return s
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/(?<=\d)S|S(?=\d)/g, "5");
}

/** Maximum plausible value per serving for any nutrition field */
const MAX_NUTRITION_VALUE = 10000;

/** Extract a numeric value from a string, applying OCR correction */
function extractNumber(raw: string): number | null {
  const fixed = fixOCRDigits(raw.trim());
  const num = parseFloat(fixed);
  if (isNaN(num) || num < 0 || num > MAX_NUTRITION_VALUE) return null;
  return num;
}

interface FieldPattern {
  key: keyof Omit<LocalNutritionData, "servingSize" | "confidence">;
  pattern: RegExp;
}

const FIELD_PATTERNS: FieldPattern[] = [
  { key: "calories", pattern: /calories\s+(?!from\b)<?(\S+)/i },
  { key: "totalFat", pattern: /total\s+fat\s+<?(\S+?)g/i },
  { key: "saturatedFat", pattern: /saturated\s+fat\s+<?(\S+?)g/i },
  { key: "transFat", pattern: /trans\s+fat\s+<?(\S+?)g/i },
  { key: "cholesterol", pattern: /cholesterol\s+<?(\S+?)mg/i },
  { key: "sodium", pattern: /sodium\s+<?(\S+?)mg/i },
  {
    key: "totalCarbs",
    pattern: /total\s+carb(?:ohydrate|s|\.?)?\s+<?(\S+?)g/i,
  },
  { key: "dietaryFiber", pattern: /dietary\s+fiber\s+<?(\S+?)g/i },
  { key: "totalSugars", pattern: /total\s+sugars?\s+<?(\S+?)g/i },
  { key: "protein", pattern: /protein\s+<?(\S+?)g/i },
];

const SERVING_SIZE_PATTERN = /serving\s+size\s+(.+)/i;

/** Total number of numeric fields used to calculate confidence */
const TOTAL_FIELDS = FIELD_PATTERNS.length;

export function parseNutritionFromOCR(text: string): LocalNutritionData {
  const result: LocalNutritionData = {
    calories: null,
    totalFat: null,
    saturatedFat: null,
    transFat: null,
    cholesterol: null,
    sodium: null,
    totalCarbs: null,
    dietaryFiber: null,
    totalSugars: null,
    protein: null,
    servingSize: null,
    confidence: 0,
  };

  if (!text.trim()) return result;

  // Extract serving size (free-form text, not numeric)
  const servingMatch = text.match(SERVING_SIZE_PATTERN);
  if (servingMatch) {
    result.servingSize = servingMatch[1].trim().slice(0, 100);
  }

  // Extract numeric fields
  let extracted = 0;
  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = extractNumber(match[1]);
      if (value !== null) {
        result[key] = value;
        extracted++;
      }
    }
  }

  result.confidence = extracted / TOTAL_FIELDS;

  return result;
}
