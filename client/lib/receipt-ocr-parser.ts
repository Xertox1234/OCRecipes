export interface LocalReceiptItem {
  rawName: string;
  price: string | null;
  quantity: number;
}

interface ParsedReceipt {
  items: LocalReceiptItem[];
  storeName: string | null;
  totalAmount: string | null;
  confidence: number;
}

const PRICE_RE = /\b(\d+\.\d{2})\b/;
const SUMMARY_RE = /\b(total|subtotal|tax|balance|amount\s+due|amount|due)\b/i;
const QTY_AT_RE = /^(\d+)\s+@\s+/;
const QTY_X_RE = /^(\d+)x\s+/i;

function extractPrice(line: string): string | null {
  const m = line.match(PRICE_RE);
  return m ? m[1] : null;
}

function isSummaryLine(line: string, price: string | null): boolean {
  if (!price) return false;
  return SUMMARY_RE.test(line);
}

function isStoreName(line: string): boolean {
  if (!line.trim()) return false;
  if (extractPrice(line)) return false;
  // All-caps word(s) or title-case, no digits
  if (/\d/.test(line)) return false;
  return true;
}

function stripPrice(line: string): string {
  return line.replace(PRICE_RE, "").trim().replace(/\s+/g, " ");
}

export function parseReceiptItemsFromOCR(texts: string[]): ParsedReceipt {
  const empty: ParsedReceipt = {
    items: [],
    storeName: null,
    totalAmount: null,
    confidence: 0,
  };
  if (texts.length === 0) return empty;

  let storeName: string | null = null;
  let totalAmount: string | null = null;
  const allItems: LocalReceiptItem[] = [];
  const seen = new Set<string>();

  for (let photoIdx = 0; photoIdx < texts.length; photoIdx++) {
    const lines = texts[photoIdx]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    let lineStart = 0;

    // First line of first photo: candidate store name
    if (photoIdx === 0 && lines.length > 0 && isStoreName(lines[0])) {
      storeName = lines[0];
      lineStart = 1;
    }

    for (let i = lineStart; i < lines.length; i++) {
      const line = lines[i];
      const price = extractPrice(line);

      if (isSummaryLine(line, price)) {
        // Capture the first total-like line as the total amount
        if (!totalAmount && /\btotal\b/i.test(line) && price) {
          totalAmount = price;
        }
        continue;
      }

      if (!price) continue;

      // Must have at least 2 alpha chars to be a real item name
      const withoutPrice = stripPrice(line);
      if ((withoutPrice.match(/[a-zA-Z]/g) ?? []).length < 2) continue;

      let quantity = 1;
      let name = withoutPrice;

      const atMatch = name.match(QTY_AT_RE);
      if (atMatch) {
        quantity = parseInt(atMatch[1], 10);
        name = name.replace(QTY_AT_RE, "").trim();
      } else {
        const xMatch = name.match(QTY_X_RE);
        if (xMatch) {
          quantity = parseInt(xMatch[1], 10);
          name = name.replace(QTY_X_RE, "").trim();
        }
      }

      name = name.replace(/\s+/g, " ").trim();
      if (!name) continue;

      const dedupeKey = `${name.toUpperCase()}|${price}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      allItems.push({ rawName: name, price, quantity });
    }
  }

  const confidence = Math.min(1, allItems.length / 8);

  return { items: allItems, storeName, totalAmount, confidence };
}
