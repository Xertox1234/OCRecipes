// server/services/label-compare.ts
/**
 * The compare card (Coach roadmap T4): two scanned products side by side.
 * The model names two scans by the ids get_recent_scans gave it and never
 * writes their numbers; this reads both scans for the user, so a card only
 * ever shows what the scans stored. Each product stays per its own serving.
 */
import { storage } from "../storage";
import type { LabelCompareBlock } from "@shared/schemas/coach-blocks";

type Item = LabelCompareBlock["items"][number];

/**
 * A stored decimal as a number, or null where the label had none (or the
 * value is not a real amount). Shared with get_recent_scans, so the model and
 * the card read a scan the same way.
 */
export function scanAmount(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * The card for two scans, in the order the model named them. Throws when
 * either is missing: not this user's, discarded, or never there, so no card
 * shows one product beside nothing.
 */
export async function buildLabelCompareBlock(
  scanIds: [number, number],
  userId: string,
): Promise<LabelCompareBlock> {
  const rows = await storage.getScannedItemsByIds(scanIds, userId);
  const items = scanIds.map((id): Item => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`scan ${id} is not one of this user's scans`);
    return {
      scanId: row.id,
      name: row.productName,
      brand: row.brandName,
      servingSize: row.servingSize,
      calories: scanAmount(row.calories),
      protein: scanAmount(row.protein),
      carbs: scanAmount(row.carbs),
      fat: scanAmount(row.fat),
      fiber: scanAmount(row.fiber),
      sugar: scanAmount(row.sugar),
      sodium: scanAmount(row.sodium),
    };
  });
  return { type: "label_compare", items: [items[0], items[1]] };
}
