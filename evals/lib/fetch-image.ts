import sharp from "sharp";

/** The upload bound and JPEG quality (1–100) one app scan path applies. */
export interface UploadSize {
  maxEdge: number;
  quality: number;
}

const cache = new Map<string, Promise<string>>();

/**
 * Fetch a public image once per process and return it as base64 JPEG, sized
 * the way the app sizes that scan's upload. `compressImage` in
 * `client/lib/image-compression.ts` bounds both edges and re-encodes at the
 * path's quality, so the caller passes that path's values (see
 * `client/lib/photo-upload.ts`). The app's further quality step-down for
 * files over its `targetSizeKB` is not reproduced. EXIF orientation is
 * applied (phone photos arrive sideways otherwise). A PNG source is flattened
 * onto white. Wikimedia asks for a descriptive User-Agent and answers 429
 * under bursts, so a 429 is retried a few times.
 */
export function fetchImageAsJpegBase64(
  url: string,
  size: UploadSize,
): Promise<string> {
  const key = `${url}|${size.maxEdge}|${size.quality}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = load(url, size);
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

async function load(url: string, size: UploadSize): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "OCRecipes-eval/1.0 (dev eval fixtures)" },
    });
    if (response.ok) {
      const input = Buffer.from(await response.arrayBuffer());
      const jpeg = await sharp(input)
        .rotate() // apply EXIF orientation first, as the app's compressImage does
        .flatten({ background: "#ffffff" })
        .resize({
          width: size.maxEdge,
          height: size.maxEdge,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: size.quality })
        .toBuffer();
      return jpeg.toString("base64");
    }
    lastStatus = response.status;
    if (response.status !== 429) break;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error(`Failed to fetch image from ${url}: HTTP ${lastStatus}`);
}
