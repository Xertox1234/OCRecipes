/** Community counts for one public community recipe, computed from rows on read. */
export interface RecipeCommunityStats {
  triedCount: number;
  triedByMe: boolean;
  favouritedCount: number;
  variantCount: number;
}

/** One public remix of a community recipe. Never carries the author. */
export interface RecipeVariantDto {
  id: number;
  title: string;
  imageUrl: string | null;
  createdAt: string; // ISO string on the wire
}
