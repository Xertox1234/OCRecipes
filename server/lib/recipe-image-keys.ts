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

/** Extract the single-segment filename of an our-bucket recipe image URL.
 * Strips any `?v=` cache-busting query first so versioned URLs still resolve
 * the underlying R2 key on subsequent backfill runs. */
export function deriveRecipeImageFilename(url: string): string | null {
  const pathname = url.split("?")[0];
  const m = pathname.match(/\/recipe-images\/([A-Za-z0-9._-]+)$/);
  return m ? m[1] : null;
}

/**
 * Append (or replace) a cache-busting `?v=` token so clients that cache by URL
 * (e.g. expo-image) re-fetch an image whose bytes were overwritten in place.
 * The R2 object key is unchanged; only the stored URL changes.
 */
export function bustImageUrl(url: string, version: string | number): string {
  const base = url.split("?")[0];
  return `${base}?v=${version}`;
}
