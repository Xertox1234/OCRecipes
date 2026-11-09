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
  it("finds a Recipe nested as deep as the server's finder does", () => {
    const R = { "@type": "Recipe" };
    expect(hasRecipeBlock(r({ "@graph": [{ "@graph": [R] }] }))).toBe(true);
    expect(hasRecipeBlock(r([[R]]))).toBe(true);
    expect(hasRecipeBlock(r({ "@graph": [[R]] }))).toBe(true);
  });
  it("gives up past the depth cap", () => {
    let deep: unknown = { "@type": "Recipe" };
    for (let i = 0; i < 20; i++) deep = [deep];
    expect(hasRecipeBlock(r(deep))).toBe(false);
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
  it("strips auth-looking query params and the fragment", () => {
    expect(
      resolveImportedUrl(
        "https://site.test/r/1?code=abc&state=x&serving=4#top",
        "https://a.test",
      ),
    ).toBe("https://site.test/r/1?serving=4");
    expect(
      resolveImportedUrl(
        "https://site.test/r?Access_Token=1&ID_TOKEN=2&token=3&session=4&auth=5&sig=6&signature=7",
        "https://a.test",
      ),
    ).toBe("https://site.test/r");
    expect(
      resolveImportedUrl("https://site.test/r?utm=a&page=2", "https://a.test"),
    ).toBe("https://site.test/r?utm=a&page=2");
  });
  it("falls back to the pasted URL when the current one is too long for parse-page", () => {
    const long = `https://site.test/r?q=${"x".repeat(1100)}`;
    expect(resolveImportedUrl(long, "https://a.test/r")).toBe(
      "https://a.test/r",
    );
  });
  it("keeps a long URL whose length was all auth params", () => {
    const long = `https://site.test/r?token=${"x".repeat(1100)}`;
    expect(resolveImportedUrl(long, "https://a.test/r")).toBe(
      "https://site.test/r",
    );
  });
});
