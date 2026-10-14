// Spec 2026-10-12 §3: search (titles only) → AI listing → store. Cards are
// text-only; a photo is generated only when a card is made into a recipe.
import {
  searchCatalogRecipes,
  buildIntolerancesParam,
} from "../recipe-catalog";
import { suggestListing } from "./suggest-listing";
import { storage } from "../../storage";
import { createServiceLogger, toError } from "../../lib/logger";
import type { UserProfile } from "@shared/schema";
import {
  SUGGESTION_TTL_MS,
  toSuggestion,
  type CreateListingBody,
  type Suggestion,
} from "@shared/schemas/inspired-recipes";

const log = createServiceLogger("inspired-listing");

async function inspirationTitles(
  request: string,
  filters: Omit<CreateListingBody, "query">,
  profile: UserProfile | null | undefined,
): Promise<string[]> {
  try {
    // Non-strict: an unset API key yields an empty result, not a throw.
    const res = await searchCatalogRecipes({
      query: request,
      cuisine: filters.cuisine,
      diet: filters.diet,
      type: filters.mealType,
      maxReadyTime: filters.maxReadyTime,
      intolerances: buildIntolerancesParam(profile?.allergies),
      number: 10,
    });
    // Titles only — never ids or images (Global Constraints).
    return res.results.map((r) => r.title);
  } catch (error) {
    // Quota (CatalogQuotaError), network or HTTP failure: list without inspiration.
    log.info(
      { err: toError(error) },
      "inspiration search unavailable; listing from profile only",
    );
    return [];
  }
}

export async function createSuggestionListing(args: {
  userId: string;
  request: string;
  filters: Omit<CreateListingBody, "query">;
  profile: UserProfile | null | undefined;
  count: number;
  useSpoonacular: boolean;
}): Promise<Suggestion[] | null> {
  const titles = args.useSpoonacular
    ? await inspirationTitles(args.request, args.filters, args.profile)
    : [];
  const input = {
    request: args.request,
    inspirationTitles: titles,
    profile: args.profile,
    count: args.count,
  };
  // Spec §7: one retry before giving up.
  const drafts = (await suggestListing(input)) ?? (await suggestListing(input));
  if (!drafts) return null;
  const rows = await storage.createInspiredSuggestions(
    args.userId,
    drafts,
    new Date(Date.now() + SUGGESTION_TTL_MS),
  );
  return rows.map(toSuggestion);
}
