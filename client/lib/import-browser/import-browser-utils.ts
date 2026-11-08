import {
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

function hasRecipeType(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const t = (node as Record<string, unknown>)["@type"];
  return t === "Recipe" || (Array.isArray(t) && t.includes("Recipe"));
}

/** Cheap device-side hint only; the server stays the authority. */
export function hasRecipeBlock(blocks: string[]): boolean {
  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const roots = Array.isArray(parsed) ? parsed : [parsed];
    for (const root of roots) {
      if (hasRecipeType(root)) return true;
      if (typeof root === "object" && root !== null) {
        const graph = (root as Record<string, unknown>)["@graph"];
        if (Array.isArray(graph) && graph.some(hasRecipeType)) return true;
      }
    }
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

export function resolveImportedUrl(
  currentUrl: string | undefined,
  pastedUrl: string,
): string {
  return currentUrl && /^https?:\/\//i.test(currentUrl)
    ? currentUrl
    : pastedUrl;
}
