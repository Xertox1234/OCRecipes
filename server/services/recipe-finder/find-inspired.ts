// server/services/recipe-finder/find-inspired.ts
// The finder's online step now returns our own AI-written cards (spec 2026-10-12).
import { createSuggestionListing } from "../inspired-recipes";
import type { UserProfile } from "@shared/schema";
import {
  FINDER_MAX_ITEMS,
  type FinderItem,
  type RecipeQuery,
} from "@shared/schemas/recipe-finder";

export type FindOnlineResult =
  | { status: "ok"; items: FinderItem[] }
  | { status: "unavailable" };

export async function findInspired(args: {
  userId: string;
  request: string;
  query: RecipeQuery;
  profile: UserProfile | null | undefined;
  useSpoonacular: boolean;
}): Promise<FindOnlineResult> {
  const cards = await createSuggestionListing({
    userId: args.userId,
    request: args.request,
    filters: {
      cuisine: args.query.cuisine,
      diet: args.query.diet,
      mealType: args.query.mealType,
      maxReadyTime: args.query.maxPrepTime,
    },
    profile: args.profile,
    count: FINDER_MAX_ITEMS,
    useSpoonacular: args.useSpoonacular,
  });
  if (!cards) return { status: "unavailable" };
  return {
    status: "ok",
    items: cards.map((c) => ({
      id: c.id,
      source: "inspired" as const,
      title: c.title,
      description: c.description,
      imageUrl: c.imageUrl,
      readyInMinutes: c.totalMinutes,
      calories: null,
    })),
  };
}
