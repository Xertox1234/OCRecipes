import { describe, it, expect } from "vitest";
import { loggedPath, requestLogFields, urlPathOnly } from "../log-url";

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

// Security audit 2026-11-12, L12: two routes carry the scanned barcode in the
// path itself, so cutting the query string does not keep it out of the log.
describe("loggedPath", () => {
  it("replaces the scanned barcode in the nutrition path", () => {
    expect(loggedPath("/api/nutrition/barcode/0123456789012?fresh=1")).toBe(
      "/api/nutrition/barcode/:code",
    );
    expect(loggedPath("/api/nutrition/barcode/0123456789012/")).toBe(
      "/api/nutrition/barcode/:code",
    );
  });

  it("replaces the scanned barcode in the verification path", () => {
    expect(loggedPath("/api/verification/0123456789012")).toBe(
      "/api/verification/:barcode",
    );
  });

  it("replaces a value the route would refuse as well", () => {
    expect(loggedPath("/api/nutrition/barcode/not%20a%20code")).toBe(
      "/api/nutrition/barcode/:code",
    );
    expect(loggedPath("/api/verification/abc123")).toBe(
      "/api/verification/:barcode",
    );
  });

  it("matches the way the router does, whatever the letter case", () => {
    expect(loggedPath("/API/Nutrition/Barcode/0123456789012")).toBe(
      "/api/nutrition/barcode/:code",
    );
  });

  it.each([
    "/api/verification/submit",
    "/api/verification/front-label",
    "/api/verification/front-label/confirm",
    "/api/verification/reformulation-flags",
    "/api/verification/reformulation-flags/12/resolve",
    "/api/verification/user-count",
    "/api/nutrition/lookup",
    "/api/recipes/12",
  ])("leaves %s as it is", (path) => {
    expect(loggedPath(path)).toBe(path);
  });
});

describe("requestLogFields", () => {
  const ID = "3f2b1c9e-8a47-4d1e-9b0a-5c6d7e8f9a0b";

  it("logs the checked request id, never the header the client sent", () => {
    const fields = requestLogFields({
      id: ID,
      method: "GET",
      url: "/api/recipes/12",
      headers: {
        "content-type": "application/json",
        "user-agent": "OCRecipes/5.2.0",
        "x-request-id": "A".repeat(4000),
        authorization: "Bearer secret",
      },
    });

    expect(fields).toEqual({
      id: ID,
      method: "GET",
      url: "/api/recipes/12",
      headers: {
        "content-type": "application/json",
        "user-agent": "OCRecipes/5.2.0",
      },
    });
  });

  it("logs the path with the barcode replaced and the query cut", () => {
    const fields = requestLogFields({
      id: ID,
      method: "GET",
      url: "/api/nutrition/barcode/0123456789012?fresh=1",
      headers: {},
    });

    expect(fields.url).toBe("/api/nutrition/barcode/:code");
  });
});
