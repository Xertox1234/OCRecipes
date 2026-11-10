import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { register } from "../product-images";

vi.mock("express-rate-limit");

// Privacy audit M1: the phone loads Open Food Facts product photos from our
// server, which fetches them from one fixed host.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const PATH = "/images/products/301/762/042/2003/front_en.879.400.jpg";

function createApp() {
  const app = express();
  register(app);
  return app;
}

function upstream(body: Buffer, init: { status?: number } = {}) {
  return new Response(new Uint8Array(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "image/jpeg" },
  });
}

describe("GET /api/product-image", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves the image from the fixed OFF host with long caching", async () => {
    mockFetch.mockResolvedValueOnce(upstream(PNG));

    const res = await request(createApp())
      .get("/api/product-image")
      .query({ path: PATH })
      .set("Cookie", "session=secret")
      .set("X-Forwarded-For", "203.0.113.7");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/max-age=\d{6,}/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(res.body)).toEqual(PNG);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(`https://images.openfoodfacts.org${PATH}`);
    // Nothing from the user's request goes upstream, and no redirect is
    // followed off the fixed host.
    expect(init.redirect).toBe("error");
    expect(init.headers).toEqual({
      "User-Agent": "OCRecipes/1.0 (https://ocrecipes.com)",
    });
  });

  it.each([
    ["missing", undefined],
    ["traversal", "/images/products/1/../../x.jpg"],
    ["another site", "//evil.com/images/products/1/a.jpg"],
    ["not a product image", "/images/other/1/a.jpg"],
  ])("rejects a %s path with 400 and never fetches", async (_label, path) => {
    const req = request(createApp()).get("/api/product-image");
    const res = await (path === undefined ? req : req.query({ path }));

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a repeated path parameter", async () => {
    const res = await request(createApp()).get(
      `/api/product-image?path=${encodeURIComponent(PATH)}&path=${encodeURIComponent(PATH)}`,
    );
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when OFF has no such image", async () => {
    mockFetch.mockResolvedValueOnce(
      upstream(Buffer.from("nope"), { status: 404 }),
    );

    const res = await request(createApp())
      .get("/api/product-image")
      .query({ path: PATH });

    expect(res.status).toBe(404);
  });

  it("returns 502 when the bytes are not an image", async () => {
    mockFetch.mockResolvedValueOnce(upstream(Buffer.from("<html>hi</html>")));

    const res = await request(createApp())
      .get("/api/product-image")
      .query({ path: PATH });

    expect(res.status).toBe(502);
  });

  it("returns 502 when the image is too large", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    mockFetch.mockResolvedValueOnce(upstream(big));

    const res = await request(createApp())
      .get("/api/product-image")
      .query({ path: PATH });

    expect(res.status).toBe(502);
  });

  it("returns 502 when OFF cannot be reached", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const res = await request(createApp())
      .get("/api/product-image")
      .query({ path: PATH });

    expect(res.status).toBe(502);
  });
});
