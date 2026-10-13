import { generateRecipeImage } from "../recipe-generation";
import { deleteImage } from "../../lib/image-store";
import { storage } from "../../storage";
import type { InspiredSuggestionRow } from "@shared/schema";

export const CARD_IMAGE_WIDTH = 768;
export const CARD_IMAGE_HEIGHT = 576;

/** Fire-and-forget per card. A late image for a row that already has one, or
 * whose card was already made (made rows are never purged), is deleted,
 * never left orphaned. */
export async function generateSuggestionImage(
  row: Pick<InspiredSuggestionRow, "id" | "title" | "tags">,
): Promise<void> {
  const url = await generateRecipeImage(
    { title: row.title, cuisine: row.tags[0] },
    { skipLLM: true, width: CARD_IMAGE_WIDTH, height: CARD_IMAGE_HEIGHT },
  );
  if (!url) return;
  const wrote = await storage.setInspiredSuggestionImage(row.id, url);
  if (!wrote) await deleteImage(url, "recipe");
}
