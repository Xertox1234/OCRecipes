import {
  chatConversations,
  chatMessages,
  communityRecipes,
  cookbooks,
  mealPlanRecipes,
} from "@shared/schema";
import { db } from "../db";
import { deleteImage } from "../lib/image-store";
import { eq, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";

// Stored images an account owns beyond its avatar, so account deletion can
// remove them from the CDN as the Privacy Policy and the delete dialog promise.
// The route collects BEFORE deleteUser (the rows cascade away) and filters
// AFTER it: once the user's rows are gone, any remaining reference belongs to
// someone else. That is what keeps a crafted meal-plan imageUrl pointing at
// another user's image from deleting it, and keeps a shared copy's picture.
// "Any remaining reference" covers every column that can hold a recipe-images/
// URL, including featured recipes' canonical_images gallery. Every path that
// deletes a client-suppliable image URL runs it through
// filterUnreferencedImageUrls first: account deletion calls it directly (the
// avatar is deleted separately), and the meal-plan update and delete paths use
// deleteImagesIfUnreferenced, which filters and then deletes.

export interface OwnedImage {
  url: string;
  kind: "recipe" | "cookbook";
}

/** Stored-object identity: deleteImage ignores a `?v=` cache-buster too. */
function stripQuery(url: string): string {
  return url.split("?")[0];
}

/** A column's value with any `?v=` stripped; NULL stays NULL (never matches). */
function withoutQuery(column: AnyColumn | SQL): SQL<string | null> {
  return sql<string | null>`split_part(${column}, '?', 1)`;
}

const chatImageUrl = sql<string>`${chatMessages.metadata}->>'imageUrl'`;

export async function collectUserImageUrls(
  userId: string,
): Promise<OwnedImage[]> {
  const [covers, community, planned, chat] = await Promise.all([
    db
      .select({ url: cookbooks.coverImageUrl })
      .from(cookbooks)
      .where(eq(cookbooks.userId, userId)),
    db
      .select({
        url: communityRecipes.imageUrl,
        gallery: communityRecipes.canonicalImages,
      })
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId)),
    db
      .select({ url: mealPlanRecipes.imageUrl })
      .from(mealPlanRecipes)
      .where(eq(mealPlanRecipes.userId, userId)),
    db
      .select({ url: chatImageUrl })
      .from(chatMessages)
      .innerJoin(
        chatConversations,
        eq(chatMessages.conversationId, chatConversations.id),
      )
      .where(eq(chatConversations.userId, userId)),
  ]);

  const seen = new Set<string>();
  const images: OwnedImage[] = [];
  const add = (rows: { url: string | null }[], kind: OwnedImage["kind"]) => {
    for (const { url } of rows) {
      if (!url || seen.has(`${kind}:${url}`)) continue;
      seen.add(`${kind}:${url}`);
      images.push({ url, kind });
    }
  };
  add(covers, "cookbook");
  const gallery = community.flatMap((r) =>
    (r.gallery ?? []).map((url) => ({ url })),
  );
  add([...community, ...gallery, ...planned, ...chat], "recipe");
  return images;
}

export async function filterUnreferencedImageUrls(
  images: OwnedImage[],
): Promise<OwnedImage[]> {
  if (images.length === 0) return [];
  const recipeKeys = images
    .filter((i) => i.kind === "recipe")
    .map((i) => stripQuery(i.url));
  const coverKeys = images
    .filter((i) => i.kind === "cookbook")
    .map((i) => stripQuery(i.url));

  const referenced = new Set<string>();
  const collect = (
    rows: { key: string | null }[],
    kind: OwnedImage["kind"],
  ) => {
    for (const { key } of rows) if (key) referenced.add(`${kind}:${key}`);
  };

  if (recipeKeys.length > 0) {
    const [community, planned, chat] = await Promise.all([
      db
        .select({ key: withoutQuery(communityRecipes.imageUrl) })
        .from(communityRecipes)
        .where(inArray(withoutQuery(communityRecipes.imageUrl), recipeKeys)),
      db
        .select({ key: withoutQuery(mealPlanRecipes.imageUrl) })
        .from(mealPlanRecipes)
        .where(inArray(withoutQuery(mealPlanRecipes.imageUrl), recipeKeys)),
      db
        .select({ key: withoutQuery(chatImageUrl) })
        .from(chatMessages)
        .where(inArray(withoutQuery(chatImageUrl), recipeKeys)),
    ]);
    const gallery = await db.execute<{ key: string }>(
      sql`select split_part(e, '?', 1) as key
          from ${communityRecipes}
          cross join lateral jsonb_array_elements_text(${communityRecipes.canonicalImages}) as e
          where split_part(e, '?', 1) in (${sql.join(
            recipeKeys.map((k) => sql`${k}`),
            sql`, `,
          )})`,
    );
    collect([...community, ...planned, ...chat, ...gallery.rows], "recipe");
  }

  if (coverKeys.length > 0) {
    const covers = await db
      .select({ key: withoutQuery(cookbooks.coverImageUrl) })
      .from(cookbooks)
      .where(inArray(withoutQuery(cookbooks.coverImageUrl), coverKeys));
    collect(covers, "cookbook");
  }

  return images.filter(
    (i) => !referenced.has(`${i.kind}:${stripQuery(i.url)}`),
  );
}

/**
 * Delete stored images that no row references any more. Call it only after
 * the rows that pointed at them are gone (committed), so any reference left
 * belongs to something else and that image is kept.
 */
export async function deleteImagesIfUnreferenced(
  images: OwnedImage[],
): Promise<void> {
  const deletable = await filterUnreferencedImageUrls(images);
  await Promise.all(deletable.map((i) => deleteImage(i.url, i.kind)));
}
