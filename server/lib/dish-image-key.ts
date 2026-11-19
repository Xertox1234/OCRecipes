import { createHash } from "node:crypto";

/**
 * Key for the shared picture of a dish name (`dish_images.name_hash`): the
 * SHA-256 of the name lower-cased, with punctuation removed and spaces
 * collapsed. A hash, so typed text never sits in a table that outlives the
 * account that typed it. `null` when nothing is left to key on.
 */
export function dishImageKey(title: string): string | null {
  const normalized = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex");
}
