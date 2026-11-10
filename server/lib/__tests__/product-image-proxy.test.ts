import { describe, it, expect } from "vitest";

import {
  isProductImagePath,
  toProductImageProxyPath,
  sanitizeStoredProductImageUrl,
} from "../product-image-proxy";

// Privacy audit M1: the phone loads Open Food Facts product photos through
// our server, so OFF never sees the user's IP address.
const OFF =
  "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_en.879.400.jpg";
const PROXIED =
  "/api/product-image?path=%2Fimages%2Fproducts%2F301%2F762%2F042%2F2003%2Ffront_en.879.400.jpg";

describe("toProductImageProxyPath", () => {
  it("turns an OFF image URL into our proxy path", () => {
    expect(toProductImageProxyPath(OFF)).toBe(PROXIED);
  });

  it("accepts an unsplit barcode directory and png/webp", () => {
    expect(
      toProductImageProxyPath(
        "https://images.openfoodfacts.org/images/products/20005733/front_fr.4.400.png",
      ),
    ).toBe(
      "/api/product-image?path=%2Fimages%2Fproducts%2F20005733%2Ffront_fr.4.400.png",
    );
  });

  it.each([
    ["another host", "https://example.com/images/products/1/front.jpg"],
    [
      "a lookalike host",
      "https://images.openfoodfacts.org.evil.com/images/products/1/front.jpg",
    ],
    [
      "userinfo pointing elsewhere",
      "https://images.openfoodfacts.org@evil.com/images/products/1/front.jpg",
    ],
    ["plain http", "http://images.openfoodfacts.org/images/products/1/a.jpg"],
    [
      "a query string",
      "https://images.openfoodfacts.org/images/products/1/a.jpg?x=1",
    ],
    ["a port", "https://images.openfoodfacts.org:8443/images/products/1/a.jpg"],
    [
      "path traversal",
      "https://images.openfoodfacts.org/images/products/1/../../x.jpg",
    ],
    [
      "a non-image file",
      "https://images.openfoodfacts.org/images/products/1/a.svg",
    ],
    ["not a URL", "front_en.jpg"],
  ])("returns null for %s", (_label, url) => {
    expect(toProductImageProxyPath(url)).toBeNull();
  });

  it("returns null for nothing", () => {
    expect(toProductImageProxyPath(undefined)).toBeNull();
    expect(toProductImageProxyPath(null)).toBeNull();
    expect(toProductImageProxyPath("")).toBeNull();
  });
});

describe("isProductImagePath", () => {
  it("accepts an OFF product image path", () => {
    expect(
      isProductImagePath(
        "/images/products/301/762/042/2003/front_en.879.400.jpg",
      ),
    ).toBe(true);
  });

  it.each([
    "/images/products/1/../x.jpg",
    "/images/products/front.jpg",
    "/images/other/1/front.jpg",
    "//evil.com/images/products/1/a.jpg",
    "/images/products/1/a.jpg?x=1",
    "/images/products/1/a%2F.jpg",
  ])("rejects %s", (path) => {
    expect(isProductImagePath(path)).toBe(false);
  });
});

describe("sanitizeStoredProductImageUrl", () => {
  it("keeps our own proxy path", () => {
    expect(sanitizeStoredProductImageUrl(PROXIED)).toBe(PROXIED);
  });

  it("converts a raw OFF URL sent by an older app version", () => {
    expect(sanitizeStoredProductImageUrl(OFF)).toBe(PROXIED);
  });

  it("drops any other URL", () => {
    expect(
      sanitizeStoredProductImageUrl("https://tracker.example/pixel.jpg"),
    ).toBeNull();
    expect(
      sanitizeStoredProductImageUrl("/api/product-image?path=%2Fetc%2Fpasswd"),
    ).toBeNull();
  });

  it("passes null and undefined through", () => {
    expect(sanitizeStoredProductImageUrl(null)).toBeNull();
    expect(sanitizeStoredProductImageUrl(undefined)).toBeUndefined();
  });
});
