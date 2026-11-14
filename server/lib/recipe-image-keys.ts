/**
 * True for the one shape every stored image name has: a single path segment
 * of plain characters (`recipe-<uuid>.jpg`). No slash, no percent-escape, no
 * name made only of dots — so a name that passes cannot point anywhere but
 * the folder it is joined to.
 */
export function isSafeStoredFilename(filename: string): boolean {
  return (
    /^[A-Za-z0-9._-]+$/.test(filename) &&
    !filename.includes("..") &&
    !/^\.+$/.test(filename)
  );
}

/**
 * Classify a stored recipe image URL by ownership. "ours" is exactly what we
 * store — `<base>/recipe-images/<one filename>`, with an optional `?v=`
 * cache-busting query — not any URL that merely starts that way: the URL can
 * come from a client, and "ours" is what lets it be saved unchanged.
 */
export function classifyRecipeImageUrl(
  url: string | null | undefined,
  r2PublicBase: string | null,
): "ours" | "external" | "none" {
  if (!url) return "none";
  const folders = ["/api/recipe-images/"];
  if (r2PublicBase) {
    folders.push(`${r2PublicBase.replace(/\/$/, "")}/recipe-images/`);
  }
  for (const folder of folders) {
    if (!url.startsWith(folder)) continue;
    const filename = url.slice(folder.length).split("?")[0];
    if (isSafeStoredFilename(filename)) return "ours";
  }
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
