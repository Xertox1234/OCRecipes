import { dishImages } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";

// The shared picture for a dish name: generated once, then reused by every
// later quick entry of the same name. Keyed by `dishImageKey(title)`.
// Deliberately not user-scoped: a row holds no typed text and no owner.

export async function getDishImageUrl(
  nameHash: string,
): Promise<string | null> {
  const [row] = await db
    .select({ imageUrl: dishImages.imageUrl })
    .from(dishImages)
    .where(eq(dishImages.nameHash, nameHash));
  return row?.imageUrl ?? null;
}

/**
 * Record a picture the server generated. First writer wins: when two people
 * enter the same new dish at once, the later one keeps its own picture and
 * the shared row is left alone.
 */
export async function recordDishImage(
  nameHash: string,
  imageUrl: string,
): Promise<void> {
  await db
    .insert(dishImages)
    .values({ nameHash, imageUrl })
    .onConflictDoNothing();
}
