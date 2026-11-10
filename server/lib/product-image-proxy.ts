/**
 * Privacy audit M1: the phone must never load a product photo from Open Food
 * Facts directly — that exposes the user's IP address to a third party. Our
 * server fetches the photo instead (`GET /api/product-image`, see
 * server/routes/product-images.ts) from ONE fixed host, so the only thing a
 * client chooses is a path that must look like an OFF product image.
 */

/** The only host the proxy ever fetches from. */
export const PRODUCT_IMAGE_HOST = "images.openfoodfacts.org";

/** Our route that serves a product photo. */
export const PRODUCT_IMAGE_ROUTE = "/api/product-image";

/**
 * `/images/products/<digit directories>/<name>.<ext>`, e.g.
 * `/images/products/301/762/042/2003/front_en.879.400.jpg`. Digit-only
 * directories and a dotted word-character file name: no `..`, no `%`, no
 * query, no second host.
 */
const PRODUCT_IMAGE_PATH =
  /^\/images\/products\/(?:\d+\/)+\w+(?:\.\w+)*\.(?:jpg|jpeg|png|webp)$/;

export function isProductImagePath(path: string): boolean {
  return PRODUCT_IMAGE_PATH.test(path);
}

function proxyPathFor(imagePath: string): string {
  return `${PRODUCT_IMAGE_ROUTE}?path=${encodeURIComponent(imagePath)}`;
}

/**
 * Our proxy path for an Open Food Facts product photo URL, or null when the
 * URL is anything else (another host, http, a port, credentials, a query).
 */
export function toProductImageProxyPath(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== PRODUCT_IMAGE_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !isProductImagePath(parsed.pathname)
  ) {
    return null;
  }
  return proxyPathFor(parsed.pathname);
}

/**
 * The image URL a client sends when saving a scanned item: keep our own proxy
 * path, convert a raw OFF URL (older app versions sent one), drop anything
 * else so a saved item can never point the phone at another host.
 */
export function sanitizeStoredProductImageUrl<T extends null | undefined>(
  url: string | T,
): string | null | T {
  if (url === null || url === undefined) return url;
  const prefix = `${PRODUCT_IMAGE_ROUTE}?path=`;
  if (url.startsWith(prefix)) {
    let imagePath: string;
    try {
      imagePath = decodeURIComponent(url.slice(prefix.length));
    } catch {
      return null;
    }
    return isProductImagePath(imagePath) ? proxyPathFor(imagePath) : null;
  }
  return toProductImageProxyPath(url);
}
