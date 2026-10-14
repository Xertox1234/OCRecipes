// Unchosen idea cards expire after 24 h; their photos go with them. A made
// card (madeRecipeId set) is never deleted, so its photo — now the recipe's — stays.
// A card mid-make (live make lock) is skipped until the lock goes stale; a photo
// that lands during a make is refused at write time and deleted by its generator.
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
    // Rows first: a card claimed (made) between list and delete is skipped by
    // the delete, and its photo — now the recipe's — must survive. Only the
    // photos of rows actually deleted are removed.
    const deleted = await storage.deleteInspiredSuggestions(
      batch.map((r) => r.id),
    );
    rows += deleted.length;
    for (const row of deleted) {
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
  }
  return { rows, images };
}
