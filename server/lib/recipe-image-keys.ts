/** Classify a stored recipe image URL by ownership for the backfill. */
export function classifyRecipeImageUrl(
  url: string | null | undefined,
  r2PublicBase: string | null,
): "ours" | "external" | "none" {
  if (!url) return "none";
  if (r2PublicBase) {
    const base = r2PublicBase.replace(/\/$/, "");
    if (url.startsWith(`${base}/recipe-images/`)) return "ours";
  }
  if (url.startsWith("/api/recipe-images/")) return "ours";
  return "external";
}

/** Extract the single-segment filename of an our-bucket recipe image URL. */
export function deriveRecipeImageFilename(url: string): string | null {
  const m = url.match(/\/recipe-images\/([A-Za-z0-9._-]+)$/);
  return m ? m[1] : null;
}
