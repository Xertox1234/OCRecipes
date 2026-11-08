import { describe, it, expect, vi } from "vitest";
import { PARSE_PAGE_MAX_BYTES } from "@shared/schemas/recipe";
import {
  EXTRACT_LD_JSON_SCRIPT,
  parseExtractorMessage,
  hasRecipeBlock,
  shouldAllowNavigation,
  resolveImportedUrl,
} from "../import-browser-utils";

const msg = (blocks: unknown, type = "ldjson") =>
  JSON.stringify({ type, blocks });

describe("EXTRACT_LD_JSON_SCRIPT", () => {
  it("posts ldjson blocks and ends with true;", () => {
    expect(EXTRACT_LD_JSON_SCRIPT).toContain("application/ld+json");
    expect(EXTRACT_LD_JSON_SCRIPT).toContain("ReactNativeWebView.postMessage");
    expect(EXTRACT_LD_JSON_SCRIPT.trim().endsWith("true;")).toBe(true);
  });
});

describe("parseExtractorMessage", () => {
  it("accepts a valid message", () => {
    expect(parseExtractorMessage(msg(["{}"]))).toEqual(["{}"]);
  });
  it("rejects bad shapes", () => {
    expect(parseExtractorMessage("not json")).toBeNull();
    expect(parseExtractorMessage(msg(["{}"], "other"))).toBeNull();
    expect(parseExtractorMessage(msg([1]))).toBeNull();
    expect(
      parseExtractorMessage(JSON.stringify({ type: "ldjson" })),
    ).toBeNull();
    expect(parseExtractorMessage("null")).toBeNull();
  });
  it("rejects more than 20 blocks", () => {
    expect(parseExtractorMessage(msg(Array(21).fill("{}")))).toBeNull();
    expect(parseExtractorMessage(msg(Array(20).fill("{}")))).not.toBeNull();
  });
  it("rejects an oversized raw string without parsing it", () => {
    const spy = vi.spyOn(JSON, "parse");
    const raw = "x".repeat(PARSE_PAGE_MAX_BYTES * 6 + 64 * 1024 + 1);
    expect(parseExtractorMessage(raw)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it("enforces the cap in UTF-8 bytes", () => {
    expect(parseExtractorMessage(msg(["é".repeat(500_001)]))).toBeNull();
    expect(parseExtractorMessage(msg(["é".repeat(500_000)]))).not.toBeNull();
  });
});

describe("hasRecipeBlock", () => {
  const r = (o: unknown) => [JSON.stringify(o)];
  it("detects Recipe in the supported shapes", () => {
    expect(hasRecipeBlock(r({ "@type": "Recipe" }))).toBe(true);
    expect(hasRecipeBlock(r([{ "@type": "Recipe" }]))).toBe(true);
    expect(hasRecipeBlock(r({ "@type": ["Recipe", "Thing"] }))).toBe(true);
    expect(
      hasRecipeBlock(
        r({ "@graph": [{ "@type": "Article" }, { "@type": "Recipe" }] }),
      ),
    ).toBe(true);
  });
  it("is false for Article-only and invalid JSON", () => {
    expect(hasRecipeBlock(r({ "@type": "Article" }))).toBe(false);
    expect(hasRecipeBlock(["{nope"])).toBe(false);
    expect(hasRecipeBlock([])).toBe(false);
  });
});

describe("shouldAllowNavigation", () => {
  it.each(["https://a.test/x", "http://a.test"])("top frame allows %s", (u) =>
    expect(shouldAllowNavigation(u, true)).toBe(true),
  );
  it.each([
    "ocrecipes://x",
    "intent://x",
    "tel:1",
    "file:///etc",
    "javascript:alert(1)",
    "about:blank",
    "about:srcdoc",
    "",
  ])("top frame blocks %s", (u) =>
    expect(shouldAllowNavigation(u, true)).toBe(false),
  );
  it.each(["about:blank", "about:srcdoc", "https://ads.test"])(
    "subframe allows %s",
    (u) => expect(shouldAllowNavigation(u, false)).toBe(true),
  );
  it.each(["ocrecipes://x", "intent://x"])("subframe blocks %s", (u) =>
    expect(shouldAllowNavigation(u, false)).toBe(false),
  );
});

describe("resolveImportedUrl", () => {
  it("prefers the current http(s) URL", () => {
    expect(resolveImportedUrl("https://b.test/r", "https://a.test")).toBe(
      "https://b.test/r",
    );
  });
  it("falls back to the pasted URL", () => {
    expect(resolveImportedUrl(undefined, "https://a.test")).toBe(
      "https://a.test",
    );
    expect(resolveImportedUrl("about:blank", "https://a.test")).toBe(
      "https://a.test",
    );
    expect(resolveImportedUrl("ocrecipes://x", "https://a.test")).toBe(
      "https://a.test",
    );
  });
});
