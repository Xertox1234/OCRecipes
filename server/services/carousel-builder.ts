import crypto from "crypto";
import type { UserProfile, CommunityRecipe } from "@shared/schema";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import type {
  CarouselRecipeCard,
  CommunityRecipeSnapshot,
} from "@shared/types/carousel";
import { storage } from "../storage";
import {
  searchCatalogRecipes,
  type CatalogSearchParams,
} from "./recipe-catalog";
import { generateMealSuggestions } from "./meal-suggestions";
import type { MealSuggestionInput } from "./meal-suggestions";
import { createServiceLogger } from "../lib/logger";
import { generateRecipeImage } from "./recipe-generation";

const log = createServiceLogger("carousel-builder");

const CAROUSEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// ── Meal type inference ──────────────────────────────────────────────

function inferMealTypeFromTime(): string {
  const hour = new Date().getHours();
  if (hour < 10) return "breakfast";
  if (hour < 14) return "lunch";
  if (hour < 17) return "snack";
  return "dinner";
}

// ── Profile hashing ──────────────────────────────────────────────────

function hashProfile(profile: UserProfile): string {
  const key = JSON.stringify({
    dietType: profile.dietType,
    allergies: profile.allergies,
    cuisinePreferences: profile.cuisinePreferences,
    cookingSkillLevel: profile.cookingSkillLevel,
    cookingTimeAvailable: profile.cookingTimeAvailable,
    foodDislikes: profile.foodDislikes,
  });
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

// ── Cooking time mapping ─────────────────────────────────────────────

function cookingTimeToMinutes(cookingTime: string | null | undefined): number {
  switch (cookingTime) {
    case "under_15":
      return 15;
    case "15_30":
      return 30;
    case "30_60":
      return 60;
    default:
      return 120;
  }
}

// ── Normalization ────────────────────────────────────────────────────

function normalizeCommunity(
  recipe: CommunityRecipe,
  profile: UserProfile | null,
): CarouselRecipeCard {
  const reason = generateCommunityReason(recipe, profile);
  const snapshot: CommunityRecipeSnapshot = {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description,
    imageUrl: recipe.imageUrl,
    difficulty: recipe.difficulty,
    timeEstimate: recipe.timeEstimate,
    servings: recipe.servings,
    dietTags: recipe.dietTags ?? [],
    instructions: recipe.instructions,
  };

  return {
    id: `community:${recipe.id}`,
    source: "community",
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    prepTimeMinutes: parseTimeEstimate(recipe.timeEstimate),
    recommendationReason: reason,
    recipeData: snapshot,
  };
}

function normalizeAi(suggestion: MealSuggestion): CarouselRecipeCard {
  const hash = crypto
    .createHash("sha256")
    .update(suggestion.title + suggestion.instructions)
    .digest("hex")
    .slice(0, 12);

  return {
    id: `ai:${hash}`,
    source: "ai",
    title: suggestion.title,
    imageUrl: null,
    prepTimeMinutes: suggestion.prepTimeMinutes,
    recommendationReason: suggestion.reasoning,
    recipeData: suggestion,
  };
}

function normalizeCatalog(result: {
  id: number;
  title: string;
  image?: string;
  readyInMinutes?: number;
}): CarouselRecipeCard {
  return {
    id: `catalog:${result.id}`,
    source: "catalog",
    title: result.title,
    imageUrl: result.image ?? null,
    prepTimeMinutes: result.readyInMinutes ?? null,
    recommendationReason: "Popular recipe matching your preferences",
    recipeData: result,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseTimeEstimate(timeEstimate: string | null): number | null {
  if (!timeEstimate) return null;
  const match = timeEstimate.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function generateCommunityReason(
  recipe: CommunityRecipe,
  profile: UserProfile | null,
): string {
  if (!profile) return "Recently added recipe";

  const tags = recipe.dietTags ?? [];
  if (
    profile.dietType &&
    tags.some((t) => t.toLowerCase() === profile.dietType!.toLowerCase())
  ) {
    return `Matches your ${profile.dietType} diet`;
  }

  if (
    profile.cuisinePreferences &&
    profile.cuisinePreferences.length > 0 &&
    tags.some((t) =>
      profile.cuisinePreferences!.some(
        (c) => c.toLowerCase() === t.toLowerCase(),
      ),
    )
  ) {
    return "Matches your cuisine preferences";
  }

  const prepMins = parseTimeEstimate(recipe.timeEstimate);
  if (prepMins && prepMins <= 30) {
    return "Quick and easy — under 30 minutes";
  }

  return "Recently added recipe";
}

// ── Main builder ─────────────────────────────────────────────────────

export async function buildCarousel(
  userId: string,
  userProfile: UserProfile | null,
  isPremium: boolean,
  dailyTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
  remainingBudget?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
): Promise<CarouselRecipeCard[]> {
  const dismissedIds = await storage.getDismissedRecipeIds(userId);

  if (isPremium) {
    return buildPremiumCarousel(
      userId,
      userProfile,
      dismissedIds,
      dailyTargets,
      remainingBudget,
    );
  }

  return buildFreeCarousel(userId, userProfile, dismissedIds);
}

async function buildFreeCarousel(
  userId: string,
  userProfile: UserProfile | null,
  dismissedIds: Set<string>,
): Promise<CarouselRecipeCard[]> {
  const recipes = await storage.getRecentCommunityRecipes(userId, {
    dietType: userProfile?.dietType,
    allergies: userProfile?.allergies,
    cuisinePreferences: userProfile?.cuisinePreferences,
    limit: 8,
  });

  return recipes
    .filter((r) => !dismissedIds.has(`community:${r.id}`))
    .map((r) => normalizeCommunity(r, userProfile))
    .slice(0, 8);
}

async function buildPremiumCarousel(
  userId: string,
  userProfile: UserProfile | null,
  dismissedIds: Set<string>,
  dailyTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
  remainingBudget?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
): Promise<CarouselRecipeCard[]> {
  const mealType = inferMealTypeFromTime();
  const results: CarouselRecipeCard[] = [];

  // 1. AI-generated suggestions (cached, separate from daily limit)
  const aiCards = await getOrGenerateAiSuggestions(
    userId,
    userProfile,
    mealType,
    dailyTargets,
    remainingBudget,
  );
  results.push(...aiCards.filter((c) => !dismissedIds.has(c.id)));

  // 2. Spoonacular catalog (filtered by user preferences)
  try {
    const params: CatalogSearchParams = {
      query: userProfile?.cuisinePreferences?.[0] ?? "healthy",
      diet: userProfile?.dietType ?? undefined,
      intolerances: userProfile?.allergies?.map((a) => a.name).join(","),
      maxReadyTime: cookingTimeToMinutes(userProfile?.cookingTimeAvailable),
      number: 4,
    };
    const catalog = await searchCatalogRecipes(params);
    results.push(
      ...catalog.results
        .filter((r) => !dismissedIds.has(`catalog:${r.id}`))
        .map(normalizeCatalog),
    );
  } catch (err) {
    log.warn(
      { error: String(err) },
      "Spoonacular fetch failed for carousel, skipping",
    );
  }

  // Generate images for any cards still missing one (e.g. catalog without Spoonacular image)
  await Promise.all(
    results
      .filter((card) => !card.imageUrl)
      .map(async (card) => {
        try {
          card.imageUrl = await generateRecipeImage(card.title, card.title);
        } catch (err) {
          log.warn(
            { error: String(err), title: card.title },
            "Carousel image generation failed, continuing without",
          );
        }
      }),
  );

  // Rank: AI first (most personalized), then catalog
  return results.slice(0, 8);
}

async function getOrGenerateAiSuggestions(
  userId: string,
  userProfile: UserProfile | null,
  mealType: string,
  dailyTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
  remainingBudget?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  },
): Promise<CarouselRecipeCard[]> {
  const profileHash = userProfile ? hashProfile(userProfile) : "no-profile";

  // Check cache first
  const cached = await storage.getCarouselCache(userId, profileHash, mealType);
  if (cached) {
    log.debug({ userId, mealType }, "Carousel cache hit");
    return cached;
  }

  // Generate fresh suggestions
  try {
    const defaults = { calories: 2000, protein: 150, carbs: 250, fat: 65 };
    const input: MealSuggestionInput = {
      userId,
      date: new Date().toISOString().split("T")[0],
      mealType,
      userProfile,
      dailyTargets: dailyTargets ?? defaults,
      existingMeals: [],
      remainingBudget: remainingBudget ?? dailyTargets ?? defaults,
    };

    const suggestions = await generateMealSuggestions(input);
    const cards = suggestions.map(normalizeAi);

    // Generate images for all cards in parallel
    await Promise.all(
      cards.map(async (card) => {
        try {
          card.imageUrl = await generateRecipeImage(card.title, card.title);
        } catch (err) {
          log.warn(
            { error: String(err), title: card.title },
            "Carousel image generation failed, continuing without",
          );
        }
      }),
    );

    // Cache the results with images (fire-and-forget)
    storage
      .setCarouselCache(
        userId,
        profileHash,
        mealType,
        cards,
        CAROUSEL_CACHE_TTL_MS,
      )
      .catch((err) =>
        log.warn(
          { error: String(err) },
          "Failed to cache carousel suggestions",
        ),
      );

    return cards;
  } catch (err) {
    log.warn(
      { error: String(err) },
      "AI suggestion generation failed for carousel, skipping",
    );
    return [];
  }
}
