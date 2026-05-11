import { eq, inArray, isNotNull, sql, count, and, desc } from "drizzle-orm";
import { db } from "../db";
import { logger } from "../lib/logger";
import { tastePicks, communityRecipes, userProfiles } from "@shared/schema";
import type {
  RecipeCandidate,
  TastePickEntry,
} from "@shared/types/taste-picks";

const PICK_COLUMNS = {
  recipeId: tastePicks.recipeId,
  title: communityRecipes.title,
  imageUrl: communityRecipes.imageUrl,
  canonicalImages: communityRecipes.canonicalImages,
  cuisineOrigin: communityRecipes.cuisineOrigin,
} as const;

function resolveImage(
  imageUrl: string | null,
  canonicalImages: string[] | null,
): string | null {
  return imageUrl ?? canonicalImages?.[0] ?? null;
}

export async function getTastePicks(userId: string): Promise<TastePickEntry[]> {
  const rows = await db
    .select(PICK_COLUMNS)
    .from(tastePicks)
    .innerJoin(communityRecipes, eq(tastePicks.recipeId, communityRecipes.id))
    .where(eq(tastePicks.userId, userId));

  return rows.flatMap((r) => {
    const imageUrl = resolveImage(r.imageUrl, r.canonicalImages);
    if (!imageUrl) return [];
    return [
      {
        recipeId: r.recipeId,
        title: r.title,
        imageUrl,
        cuisineOrigin: r.cuisineOrigin,
      },
    ];
  });
}

export interface SetTastePicksResult {
  picks: TastePickEntry[];
  cuisinePreferences: string[];
}

export async function setTastePicks(
  userId: string,
  recipeIds: number[],
): Promise<SetTastePicksResult> {
  return db.transaction(async (tx) => {
    // 1. Replace picks
    await tx.delete(tastePicks).where(eq(tastePicks.userId, userId));
    // Dedupe to honor the (userId, recipeId) unique constraint without
    // needing onConflictDoNothing — DELETE above clears all existing rows.
    const uniqueRecipeIds = [...new Set(recipeIds)];
    if (uniqueRecipeIds.length > 0) {
      await tx
        .insert(tastePicks)
        .values(uniqueRecipeIds.map((recipeId) => ({ userId, recipeId })));
    }

    // 2. Derive cuisines from picked recipes
    const derivedCuisines: string[] = [];
    if (recipeIds.length > 0) {
      const recipes = await tx
        .select({ cuisineOrigin: communityRecipes.cuisineOrigin })
        .from(communityRecipes)
        .where(inArray(communityRecipes.id, recipeIds));
      const seen = new Set<string>();
      for (const r of recipes) {
        if (r.cuisineOrigin && !seen.has(r.cuisineOrigin)) {
          seen.add(r.cuisineOrigin);
          derivedCuisines.push(r.cuisineOrigin);
        }
      }
    }

    // 3. Merge with existing profile cuisinePreferences (additive)
    const [profile] = await tx
      .select({ cuisinePreferences: userProfiles.cuisinePreferences })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));

    const existing: string[] = profile?.cuisinePreferences ?? [];
    const merged = [...new Set([...existing, ...derivedCuisines])];

    if (profile) {
      await tx
        .update(userProfiles)
        .set({ cuisinePreferences: merged, updatedAt: new Date() })
        .where(eq(userProfiles.userId, userId));
    } else if (derivedCuisines.length > 0) {
      // Cuisine merge is silently dropped when the user has no profile row yet.
      // Surface this gap in logs so the missing write-through is debuggable.
      logger.warn(
        { userId, derivedCuisines },
        "setTastePicks: no profile row, cuisine merge skipped",
      );
    }

    // 4. Fetch final picks for response
    const pickRows =
      recipeIds.length > 0
        ? await tx
            .select(PICK_COLUMNS)
            .from(tastePicks)
            .innerJoin(
              communityRecipes,
              eq(tastePicks.recipeId, communityRecipes.id),
            )
            .where(eq(tastePicks.userId, userId))
        : [];

    const picks: TastePickEntry[] = pickRows.flatMap((r) => {
      const imageUrl = resolveImage(r.imageUrl, r.canonicalImages);
      if (!imageUrl) return [];
      return [
        {
          recipeId: r.recipeId,
          title: r.title,
          imageUrl,
          cuisineOrigin: r.cuisineOrigin,
        },
      ];
    });

    return { picks, cuisinePreferences: merged };
  });
}

export interface CandidateParams {
  page: number;
  limit: number;
  dietType?: string | null;
}

export async function getTastePickCandidates(
  params: CandidateParams,
): Promise<{ candidates: RecipeCandidate[]; total: number; page: number }> {
  const { page, limit, dietType } = params;
  const offset = (page - 1) * limit;

  const baseConditions = [
    eq(communityRecipes.isPublic, true),
    isNotNull(communityRecipes.imageUrl),
  ];

  if (dietType && dietType !== "omnivore") {
    baseConditions.push(
      sql`${communityRecipes.dietTags} @> ${JSON.stringify([dietType])}::jsonb`,
    );
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(communityRecipes)
    .where(and(...baseConditions));

  const rows = await db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      imageUrl: communityRecipes.imageUrl,
      canonicalImages: communityRecipes.canonicalImages,
      cuisineOrigin: communityRecipes.cuisineOrigin,
    })
    .from(communityRecipes)
    .where(and(...baseConditions))
    .orderBy(
      desc(communityRecipes.popularityScore),
      desc(communityRecipes.createdAt),
    )
    .limit(limit)
    .offset(offset);

  const candidates: RecipeCandidate[] = rows.flatMap((r) => {
    const imageUrl = resolveImage(r.imageUrl, r.canonicalImages);
    if (!imageUrl) return [];
    return [
      { id: r.id, title: r.title, imageUrl, cuisineOrigin: r.cuisineOrigin },
    ];
  });

  return { candidates, total, page };
}
