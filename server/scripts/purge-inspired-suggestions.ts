// Unchosen idea cards expire after 24 h; their photos go with them. A made
// card (madeRecipeId set) is never listed, so its photo — now the recipe's — stays.
import { storage } from "../storage";
import { deleteImage } from "../lib/image-store";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("purge-inspired");
const MAX_BATCHES = 100;

export async function purgeExpiredInspiredSuggestions(
  now: Date,
  batchSize = 200,
): Promise<{ rows: number; images: number }> {
  let rows = 0;
  let images = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batch = await storage.listExpiredUnmadeSuggestions(now, batchSize);
    if (batch.length === 0) break;
    for (const row of batch) {
      if (!row.imageUrl) continue;
      try {
        await deleteImage(row.imageUrl, "recipe");
        images++;
      } catch (error) {
        log.warn(
          { err: toError(error), id: row.id },
          "card image delete failed",
        );
      }
    }
    rows += await storage.deleteInspiredSuggestions(batch.map((r) => r.id));
  }
  return { rows, images };
}
