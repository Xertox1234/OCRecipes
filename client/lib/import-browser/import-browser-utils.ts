import {
  importUrlSchema,
  PARSE_PAGE_MAX_BLOCKS,
  PARSE_PAGE_MAX_BYTES,
  utf8ByteLength,
} from "@shared/schemas/recipe";

/**
 * Upper bound on the raw message length, checked before JSON.parse. A valid
 * message holds <= PARSE_PAGE_MAX_BYTES of block text; JSON escaping can grow
 * a character at most 6x (a control char becomes \\u00XX) and UTF-16 length
 * never exceeds UTF-8 byte length, so 6x plus 64 KiB for the envelope can
 * never reject a valid payload.
 */
const MAX_RAW_LENGTH = PARSE_PAGE_MAX_BYTES * 6 + 64 * 1024;

/**
 * Injected into the page: collects every JSON-LD script's text and posts it to
 * the app. Ends with `true;` as react-native-webview requires.
 */
export const EXTRACT_LD_JSON_SCRIPT = `
(function () {
  try {
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    var blocks = [];
    for (var i = 0; i < nodes.length; i++) {
      blocks.push(nodes[i].textContent || "");
    }
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ldjson", blocks: blocks }));
  } catch (e) {}
})();
true;
`;

export function parseExtractorMessage(raw: string): string[] | null {
  if (raw.length > MAX_RAW_LENGTH) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { type, blocks } = data as { type?: unknown; blocks?: unknown };
  if (type !== "ldjson" || !Array.isArray(blocks)) return null;
  if (blocks.length > PARSE_PAGE_MAX_BLOCKS) return null;
  let total = 0;
  for (const b of blocks) {
    if (typeof b !== "string") return null;
    total += utf8ByteLength(b);
    if (total > PARSE_PAGE_MAX_BYTES) return null;
  }
  return blocks as string[];
}

/** Nesting depth searched for a Recipe; real pages need 2-3. */
const RECIPE_SEARCH_MAX_DEPTH = 8;

/**
 * Mirrors the server's findRecipeInLdJson (type, then @graph, then array,
 * recursively) so the found bar agrees with what the server can import.
 */
function containsRecipe(node: unknown, depth: number): boolean {
  if (depth > RECIPE_SEARCH_MAX_DEPTH) return false;
  if (typeof node !== "object" || node === null) return false;
  if (Array.isArray(node)) {
    return node.some((item) => containsRecipe(item, depth + 1));
  }
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"))) {
    return true;
  }
  const graph = obj["@graph"];
  return (
    Array.isArray(graph) &&
    graph.some((item) => containsRecipe(item, depth + 1))
  );
}

/**
 * Cheap device-side hint for the found bar only; the server stays the
 * authority and decides every import.
 */
export function hasRecipeBlock(blocks: string[]): boolean {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (containsRecipe(parsed, 0)) return true;
  }
  return false;
}

/**
 * Top frame: http(s) only. Subframes (ads, embeds) may also use about:blank /
 * about:srcdoc. Anything else is refused and never handed to Linking.
 */
export function shouldAllowNavigation(
  url: string,
  isTopFrame: boolean,
): boolean {
  if (/^https?:\/\//i.test(url)) return true;
  if (!isTopFrame) return url === "about:blank" || url === "about:srcdoc";
  return false;
}

/** Query keys that look like sign-in state; never saved as a recipe source. */
const AUTH_QUERY_KEYS = new Set([
  "code",
  "state",
  "token",
  "access_token",
  "id_token",
  "session",
  "auth",
  "sig",
  "signature",
]);

function decodeKey(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
}

/**
 * Drops the #fragment and auth-looking query params. String-based on
 * purpose: React Native's URL is a regex subset (no hash setter) that
 * behaves differently from Node's, so tests would not cover the device.
 * Other params keep their exact encoding.
 */
function stripAuthParams(url: string): string {
  const hashAt = url.indexOf("#");
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = noHash.indexOf("?");
  if (queryAt === -1) return noHash;
  const kept = noHash
    .slice(queryAt + 1)
    .split("&")
    .filter((pair) => {
      if (!pair) return false;
      const eq = pair.indexOf("=");
      const key = decodeKey(eq === -1 ? pair : pair.slice(0, eq));
      return !AUTH_QUERY_KEYS.has(key.toLowerCase());
    });
  const base = noHash.slice(0, queryAt);
  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

/**
 * The URL sent to parse-page and saved as the recipe's source: the page the
 * recipe came from, cleaned of sign-in params; the pasted URL when the page's
 * URL would fail parse-page's own url rule (non-http(s), or over 1024 chars).
 */
export function resolveImportedUrl(
  currentUrl: string | undefined,
  pastedUrl: string,
): string {
  if (!currentUrl) return pastedUrl;
  const cleaned = stripAuthParams(currentUrl);
  return importUrlSchema.shape.url.safeParse(cleaned).success
    ? cleaned
    : pastedUrl;
}
