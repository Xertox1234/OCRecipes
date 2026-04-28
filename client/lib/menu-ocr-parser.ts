export interface LocalMenuItem {
  name: string;
  description?: string;
  price?: string;
}

export interface ParsedMenu {
  items: LocalMenuItem[];
  restaurantName: string | null;
  confidence: number;
}

const PRICE_RE = /([€£\$])?\s?(\d{1,3}(?:[.,]\d{2}))\b/;
const SECTION_HEADER_RE =
  /^(menu|appetizers?|starters?|entrees?|mains?|sides?|drinks?|beverages?|desserts?|soups?|salads?)\s*$/i;

function extractPrice(line: string): string | null {
  const m = line.match(PRICE_RE);
  if (!m) return null;
  const symbol = m[1] ?? "$";
  return `${symbol}${m[2]}`;
}

function stripPrice(line: string): string {
  return line
    .replace(PRICE_RE, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[-–—|]+$/, "")
    .trim();
}

function isRestaurantName(line: string): boolean {
  if (!line.trim()) return false;
  if (/\d/.test(line)) return false;
  const words = line.trim().split(/\s+/);
  if (words.length > 4) return false;
  // At least the first word should start with a capital letter
  if (!/^[A-Z]/.test(words[0])) return false;
  return true;
}

export function parseMenuFromOCR(text: string): ParsedMenu {
  const empty: ParsedMenu = { items: [], restaurantName: null, confidence: 0 };
  if (!text.trim()) return empty;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return empty;

  let restaurantName: string | null = null;
  let startIndex = 0;

  // First non-empty line is a candidate for the restaurant name.
  // Guard: if the very next line is a standalone price, the first line is an
  // item name, not a restaurant name (e.g. "Pasta Carbonara\n$16.00").
  if (isRestaurantName(lines[0]) && !extractPrice(lines[0])) {
    const nextLine = lines[1] ?? "";
    const nextIsStandalonePrice =
      extractPrice(nextLine) !== null && stripPrice(nextLine).length < 2;
    if (!nextIsStandalonePrice) {
      restaurantName = lines[0];
      startIndex = 1;
    }
  }

  const items: LocalMenuItem[] = [];
  let pendingName: string | null = null;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];

    if (SECTION_HEADER_RE.test(line)) {
      pendingName = null;
      continue;
    }

    const price = extractPrice(line);

    if (price) {
      const nameOnSameLine = stripPrice(line);

      if (nameOnSameLine.length >= 2) {
        // Price is inline with item name on same line
        if (pendingName) {
          // Flush previous pending name with no price
          items.push({ name: pendingName });
          pendingName = null;
        }
        items.push({ name: nameOnSameLine, price });
      } else if (pendingName) {
        // Standalone price line — pair with pending item name
        items.push({ name: pendingName, price });
        pendingName = null;
      }
    } else {
      // Non-price line — could be an item name or description
      if (pendingName) {
        // Treat previous pending as an item without price; this line might be a description
        // Only save if it doesn't look like it might be a section header
        if (!SECTION_HEADER_RE.test(pendingName)) {
          items.push({ name: pendingName });
        }
      }
      pendingName = line;
    }
  }

  // Flush any trailing pending name
  if (pendingName && !SECTION_HEADER_RE.test(pendingName)) {
    items.push({ name: pendingName });
  }

  const confidence =
    Math.min(1, items.length / 5) * 0.8 + (restaurantName ? 0.2 : 0);

  return { items, restaurantName, confidence };
}
