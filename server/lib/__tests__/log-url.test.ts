import { describe, it, expect } from "vitest";
import { urlPathOnly } from "../log-url";

// Privacy audit 2026-11-10 M12: query strings carry what the user typed (food
// names, chat search text), so the request log keeps the path alone.
describe("urlPathOnly", () => {
  it("drops the query string", () => {
    expect(urlPathOnly("/api/nutrition/search?q=oat+milk&limit=5")).toBe(
      "/api/nutrition/search",
    );
  });

  it("drops a fragment", () => {
    expect(urlPathOnly("/api/recipes/12#notes")).toBe("/api/recipes/12");
  });

  it("leaves a plain path as it is", () => {
    expect(urlPathOnly("/api/health")).toBe("/api/health");
  });

  it("keeps the path when the query is empty", () => {
    expect(urlPathOnly("/api/chat?")).toBe("/api/chat");
  });

  it("returns an empty string when there is no URL", () => {
    expect(urlPathOnly(undefined)).toBe("");
  });
});
