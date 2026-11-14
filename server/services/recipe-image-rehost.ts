/**
 * Privacy audit M1: an imported recipe's photo lives on the source site, and
 * showing that URL in the app made the phone contact the site (exposing the
 * user's IP address). The server copies the photo to our storage at import
 * time instead, through the same SSRF-protected fetch the page import uses.
 */
import { detectImageMimeType } from "../lib/image-mime";
import { saveRecipeImage } from "../lib/image-store";
import { classifyRecipeImageUrl } from "../lib/recipe-image-keys";
import { logger, toError } from "../lib/logger";
import {
  FETCH_TIMEOUT_MS,
  readBytesWithLimit,
  safeFetch,
} from "./recipe-import";

/** Recipe hero photos are well under this; saveRecipeImage itself caps 10 MB. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

/** True when the URL already points at our own recipe-image storage. */
export function isOurRecipeImageUrl(url: string | null | undefined): boolean {
  return (
    classifyRecipeImageUrl(url, process.env.R2_PUBLIC_BASE_URL ?? null) ===
    "ours"
  );
}

/**
 * Our copy of a recipe photo: the URL unchanged when it is already ours, a
 * freshly stored copy when it is on another site, or null when there is no
 * photo or the copy fails (blocked address, not an image, too large, storage
 * error). Never returns another site's URL.
 */
export async function rehostRecipeImage(
  url: string | null | undefined,
): Promise<string | null> {
  if (!url) return null;
  if (isOurRecipeImageUrl(url)) return url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, controller.signal, "image/*");
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
    const bytes = await readBytesWithLimit(res, MAX_IMAGE_BYTES);
    const mime = detectImageMimeType(bytes);
    if (!mime || !(mime in EXT_BY_MIME)) return null;
    return await saveRecipeImage(
      bytes,
      EXT_BY_MIME[mime as keyof typeof EXT_BY_MIME],
    );
  } catch (err) {
    logger.warn({ err: toError(err) }, "recipe image re-host failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
