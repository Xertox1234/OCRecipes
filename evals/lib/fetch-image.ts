import sharp from "sharp";

const cache = new Map<string, Promise<string>>();

/**
 * Fetch a public image once per process and return it as base64 JPEG, the
 * format the app uploads. A PNG source is flattened onto white and converted,
 * so every model gets the same bytes the camera path would send. Wikimedia
 * asks for a descriptive User-Agent and answers 429 under bursts, so a 429
 * is retried a few times.
 */
export function fetchImageAsJpegBase64(url: string): Promise<string> {
  let hit = cache.get(url);
  if (!hit) {
    hit = load(url);
    cache.set(url, hit);
    hit.catch(() => cache.delete(url));
  }
  return hit;
}

async function load(url: string): Promise<string> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": "OCRecipes-eval/1.0 (dev eval fixtures)" },
    });
    if (response.ok) {
      const input = Buffer.from(await response.arrayBuffer());
      const jpeg = await sharp(input)
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 90 })
        .toBuffer();
      return jpeg.toString("base64");
    }
    lastStatus = response.status;
    if (response.status !== 429) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Failed to fetch image from ${url}: HTTP ${lastStatus}`);
}
