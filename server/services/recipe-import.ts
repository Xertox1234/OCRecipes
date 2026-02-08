import { z } from "zod";
import * as cheerio from "cheerio";
import dns from "node:dns";
import type {
  ParsedIngredient,
  ImportedRecipeData,
} from "@shared/types/recipe-import";

export type {
  ParsedIngredient,
  ImportedRecipeData,
} from "@shared/types/recipe-import";

// ── Zod Schema for schema.org Recipe LD+JSON ─────────────────────────

const howToStepSchema = z.object({
  "@type": z.literal("HowToStep").optional(),
  text: z.string(),
});

const schemaOrgRecipeSchema = z.object({
  "@type": z.union([z.literal("Recipe"), z.array(z.string())]),
  name: z.string(),
  description: z.string().optional(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  recipeIngredient: z.array(z.string()).optional(),
  recipeInstructions: z
    .union([z.string(), z.array(z.union([z.string(), howToStepSchema]))])
    .optional(),
  prepTime: z.string().optional(),
  cookTime: z.string().optional(),
  totalTime: z.string().optional(),
  recipeYield: z.union([z.string(), z.array(z.string())]).optional(),
  recipeCuisine: z.union([z.string(), z.array(z.string())]).optional(),
  recipeCategory: z.union([z.string(), z.array(z.string())]).optional(),
  keywords: z.union([z.string(), z.array(z.string())]).optional(),
  nutrition: z
    .object({
      calories: z.string().optional(),
      proteinContent: z.string().optional(),
      carbohydrateContent: z.string().optional(),
      fatContent: z.string().optional(),
      fiberContent: z.string().optional(),
      sugarContent: z.string().optional(),
      sodiumContent: z.string().optional(),
    })
    .optional(),
});

// ── Types ────────────────────────────────────────────────────────────

export type ImportResult =
  | { success: true; data: ImportedRecipeData }
  | {
      success: false;
      error:
        | "NO_RECIPE_DATA"
        | "FETCH_FAILED"
        | "PARSE_ERROR"
        | "TIMEOUT"
        | "RESPONSE_TOO_LARGE";
    };

// ── Fetch Safety Constants ───────────────────────────────────────────

export const FETCH_TIMEOUT_MS = 10_000; // 10 seconds
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse ISO 8601 duration (e.g., "PT15M", "PT1H30M") into minutes.
 */
export function parseIsoDuration(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = duration.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  return hours * 60 + minutes;
}

/**
 * Normalize recipeInstructions from either a single string or
 * an array of strings/HowToStep objects into a single text block.
 */
export function normalizeInstructions(
  instructions: z.infer<typeof schemaOrgRecipeSchema>["recipeInstructions"],
): string | null {
  if (!instructions) return null;
  if (typeof instructions === "string") {
    return instructions.replace(/<[^>]*>/g, "").trim() || null;
  }
  return (
    instructions
      .map((step, i) => {
        const text = typeof step === "string" ? step : step.text;
        return `${i + 1}. ${text.replace(/<[^>]*>/g, "").trim()}`;
      })
      .join("\n") || null
  );
}

/**
 * Parse a recipe ingredient string into structured parts.
 * Handles patterns like "2 cups flour", "1/2 tsp salt", "3 large eggs".
 */
export function parseIngredientString(raw: string): ParsedIngredient {
  const trimmed = raw.trim();

  // Match: optional quantity (including fractions like 1/2 or unicode fractions)
  // followed by optional unit, followed by name
  const match = trimmed.match(
    /^([\d\s./\u00BC-\u00BE\u2150-\u215E]+)?\s*(tablespoons?|teaspoons?|ounces?|pounds?|gallons?|liters?|quarts?|pints?|grams?|slices?|pieces?|cloves?|stalks?|sprigs?|heads?|medium|large|small|cups?|tbsp|tsp|bunch|pinch|dash|cans?|lbs?|oz|lb|kg|ml|g|l)?\s*(?:of\s+)?(.+)/i,
  );

  if (!match || !match[3]) {
    return { name: trimmed, quantity: null, unit: null };
  }

  const quantity = match[1]?.trim() || null;
  const unit = match[2]?.trim() || null;
  const name = match[3].trim();

  return { name, quantity, unit };
}

/**
 * Extract numeric value from nutrition string (e.g., "250 calories" → "250").
 */
function parseNutritionValue(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/([\d.]+)/);
  return match ? match[1] : null;
}

function extractFirstString(val: string | string[] | undefined): string | null {
  if (!val) return null;
  if (Array.isArray(val)) return val[0] || null;
  return val;
}

function parseServings(
  recipeYield: string | string[] | undefined,
): number | null {
  const raw = extractFirstString(recipeYield);
  if (!raw) return null;
  const match = raw.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// ── LD+JSON Extraction ───────────────────────────────────────────────

/**
 * Find a Recipe object in parsed LD+JSON data.
 * Handles both top-level Recipe and @graph arrays.
 */
export function findRecipeInLdJson(data: unknown): unknown | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;

  // Check if this is a Recipe
  const type = obj["@type"];
  if (type === "Recipe") return obj;
  if (Array.isArray(type) && type.includes("Recipe")) return obj;

  // Check @graph array
  if (Array.isArray(obj["@graph"])) {
    for (const item of obj["@graph"] as unknown[]) {
      const found = findRecipeInLdJson(item);
      if (found) return found;
    }
  }

  // Check if it's an array at top level
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInLdJson(item);
      if (found) return found;
    }
  }

  return null;
}

// ── SSRF Protection ─────────────────────────────────────────────────

export const MAX_REDIRECTS = 3;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "::1",
]);

/**
 * Check whether an IPv4 address string falls within blocked private/reserved ranges.
 *
 * Blocked ranges:
 *   - 0.0.0.0/8        (current network)
 *   - 10.0.0.0/8       (private)
 *   - 100.64.0.0/10    (CGNAT / carrier-grade NAT)
 *   - 127.0.0.0/8      (loopback)
 *   - 169.254.0.0/16   (link-local)
 *   - 172.16.0.0/12    (private)
 *   - 192.168.0.0/16   (private)
 */
export function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed = blocked
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

/**
 * Check whether an IPv6 address string falls within blocked ranges.
 *
 * Blocked:
 *   - ::1               (loopback)
 *   - ::ffff:x.x.x.x   (IPv4-mapped — delegates to isBlockedIPv4)
 *   - fc00::/7          (unique local addresses, i.e. fc00:: and fd00::)
 *   - fe80::/10         (link-local)
 */
export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback
  if (normalized === "::1") return true;

  // IPv4-mapped IPv6: "::ffff:127.0.0.1"
  const v4MappedMatch = normalized.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/,
  );
  if (v4MappedMatch) {
    return isBlockedIPv4(v4MappedMatch[1]);
  }

  // fc00::/7 covers fc00:: through fdff::
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // fe80::/10 (link-local)
  if (normalized.startsWith("fe80")) return true;

  return false;
}

/**
 * Validate a resolved IP address against all blocked ranges.
 * Handles both IPv4 and IPv6 (including IPv4-mapped IPv6 and hex representations).
 */
export function isBlockedIP(ip: string): boolean {
  // Handle hex IPv4 representations like 0x7f000001
  if (ip.startsWith("0x") || ip.startsWith("0X")) {
    const num = parseInt(ip, 16);
    if (isNaN(num) || num < 0 || num > 0xffffffff) return true;
    const a = (num >>> 24) & 0xff;
    const b = (num >>> 16) & 0xff;
    const c = (num >>> 8) & 0xff;
    const d = num & 0xff;
    return isBlockedIPv4(`${a}.${b}.${c}.${d}`);
  }

  // IPv6 check (contains colon)
  if (ip.includes(":")) {
    return isBlockedIPv6(ip);
  }

  // IPv4 check
  return isBlockedIPv4(ip);
}

/**
 * Check whether a URL should be blocked based on its protocol, hostname,
 * and (if the hostname is a literal IP) IP range.
 */
export function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return true;
    if (BLOCKED_HOSTS.has(parsed.hostname)) return true;

    // Strip brackets from IPv6 literal hostnames like [::1]
    const rawHost = parsed.hostname.startsWith("[")
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

    // If hostname looks like an IP (v4 or v6), validate it directly
    if (rawHost.includes(":") || /^\d/.test(rawHost)) {
      if (isBlockedIP(rawHost)) return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Resolve hostname via DNS and validate the resolved IP against blocked ranges.
 * Prevents DNS rebinding by checking the *actual* IP that will be connected to.
 * Returns `true` if the host is safe, `false` if it should be blocked.
 */
export async function resolveAndValidateHost(
  hostname: string,
): Promise<boolean> {
  // Skip resolution for literal IPs — already checked by isBlockedUrl
  if (hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    return !isBlockedIP(hostname);
  }

  try {
    const { address } = await dns.promises.lookup(hostname);
    return !isBlockedIP(address);
  } catch {
    // DNS resolution failed — block
    return false;
  }
}

// ── Main Import Function ─────────────────────────────────────────────

/**
 * Read response body as text while enforcing a byte-size limit.
 * Streams the body and aborts if the accumulated size exceeds maxBytes.
 * Throws an error with message "RESPONSE_TOO_LARGE" if limit is exceeded.
 */
async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return (
    chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") +
    decoder.decode()
  );
}

/**
 * Perform a single fetch with manual redirect handling, DNS validation,
 * timeout, and response size limits.
 *
 * - Uses `redirect: "manual"` to intercept redirects
 * - Validates each redirect target with `isBlockedUrl()` and DNS resolution
 * - Follows at most MAX_REDIRECTS redirects
 */
async function safeFetch(
  initialUrl: string,
  signal: AbortSignal,
): Promise<Response> {
  let currentUrl = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    // Validate URL against blocklist
    if (isBlockedUrl(currentUrl)) {
      throw new Error("BLOCKED_URL");
    }

    // Resolve DNS and validate the resolved IP to prevent DNS rebinding
    const hostname = new URL(currentUrl).hostname;
    const hostSafe = await resolveAndValidateHost(hostname);
    if (!hostSafe) {
      throw new Error("BLOCKED_URL");
    }

    const res = await fetch(currentUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; NutriScan/1.0; +https://nutriscan.app)",
        Accept: "text/html",
      },
      redirect: "manual",
      signal,
    });

    // Not a redirect — return the response
    if (res.status < 300 || res.status >= 400) {
      return res;
    }

    // Handle redirect
    const location = res.headers.get("location");
    if (!location) {
      throw new Error("REDIRECT_NO_LOCATION");
    }

    // Resolve relative redirect URLs against the current URL
    currentUrl = new URL(location, currentUrl).href;
  }

  throw new Error("TOO_MANY_REDIRECTS");
}

export async function importRecipeFromUrl(url: string): Promise<ImportResult> {
  if (isBlockedUrl(url)) {
    return { success: false, error: "FETCH_FAILED" };
  }

  // Validate DNS resolution of the initial URL before fetching
  const initialHostname = new URL(url).hostname;
  const initialHostSafe = await resolveAndValidateHost(initialHostname);
  if (!initialHostSafe) {
    return { success: false, error: "FETCH_FAILED" };
  }

  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await safeFetch(url, controller.signal);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      return { success: false, error: "FETCH_FAILED" };
    }

    // Reject early if Content-Length header advertises an oversized response
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
      return { success: false, error: "RESPONSE_TOO_LARGE" };
    }

    // Stream body with size enforcement (handles missing/inaccurate Content-Length)
    html = await readBodyWithLimit(res, MAX_RESPONSE_BYTES);
  } catch (err) {
    if (err instanceof Error && err.message === "RESPONSE_TOO_LARGE") {
      return { success: false, error: "RESPONSE_TOO_LARGE" };
    }
    if (err instanceof Error && err.name === "AbortError") {
      return { success: false, error: "TIMEOUT" };
    }
    return { success: false, error: "FETCH_FAILED" };
  }

  const $ = cheerio.load(html);

  // Find all LD+JSON scripts
  let recipeData: unknown = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (recipeData) return; // already found
    try {
      const json = JSON.parse($(el).text());
      const found = findRecipeInLdJson(json);
      if (found) recipeData = found;
    } catch {
      // Invalid JSON, skip
    }
  });

  if (!recipeData) {
    return { success: false, error: "NO_RECIPE_DATA" };
  }

  const parsed = schemaOrgRecipeSchema.safeParse(recipeData);
  if (!parsed.success) {
    console.error("Recipe LD+JSON parse error:", parsed.error.flatten());
    return { success: false, error: "PARSE_ERROR" };
  }

  const recipe = parsed.data;

  const imageUrl = Array.isArray(recipe.image)
    ? recipe.image[0] || null
    : recipe.image || null;

  const keywords = recipe.keywords
    ? typeof recipe.keywords === "string"
      ? recipe.keywords.split(",").map((k) => k.trim())
      : recipe.keywords
    : [];

  const data: ImportedRecipeData = {
    title: recipe.name,
    description: recipe.description || null,
    servings: parseServings(recipe.recipeYield),
    prepTimeMinutes: parseIsoDuration(recipe.prepTime),
    cookTimeMinutes: parseIsoDuration(recipe.cookTime),
    cuisine: extractFirstString(recipe.recipeCuisine),
    dietTags: keywords,
    ingredients: (recipe.recipeIngredient || []).map(parseIngredientString),
    instructions: normalizeInstructions(recipe.recipeInstructions),
    imageUrl,
    caloriesPerServing: parseNutritionValue(recipe.nutrition?.calories),
    proteinPerServing: parseNutritionValue(recipe.nutrition?.proteinContent),
    carbsPerServing: parseNutritionValue(recipe.nutrition?.carbohydrateContent),
    fatPerServing: parseNutritionValue(recipe.nutrition?.fatContent),
    sourceUrl: url,
  };

  return { success: true, data };
}
