import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { rehostRecipeImage } from "../recipe-image-rehost";
import { saveRecipeImage } from "../../lib/image-store";

// Privacy audit M1: an imported recipe's photo is copied to our storage, so
// the phone never loads it from the source site (which would see its IP).

const { mockLookup } = vi.hoisted(() => ({ mockLookup: vi.fn() }));
vi.mock("node:dns", () => ({
  default: { promises: { lookup: mockLookup } },
  promises: { lookup: mockLookup },
}));

vi.mock("../../lib/image-store", () => ({
  saveRecipeImage: vi.fn(),
}));

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const R2 = "https://cdn.ocrecipes.test";

function imageResponse(body: Buffer, status = 200) {
  return new Response(new Uint8Array(body), {
    status,
    headers: { "Content-Type": "image/jpeg" },
  });
}

describe("rehostRecipeImage", () => {
  const mockFetch = vi.fn();
  let savedBase: string | undefined;

  beforeEach(() => {
    mockFetch.mockReset();
    mockLookup.mockReset();
    mockLookup.mockResolvedValue({ address: "93.184.216.34", family: 4 });
    vi.mocked(saveRecipeImage).mockReset();
    vi.mocked(saveRecipeImage).mockResolvedValue(
      `${R2}/recipe-images/recipe-1.jpg`,
    );
    vi.stubGlobal("fetch", mockFetch);
    savedBase = process.env.R2_PUBLIC_BASE_URL;
    process.env.R2_PUBLIC_BASE_URL = R2;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedBase === undefined) delete process.env.R2_PUBLIC_BASE_URL;
    else process.env.R2_PUBLIC_BASE_URL = savedBase;
  });

  it("copies a source-site photo to our storage and returns our URL", async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(JPEG));

    const url = await rehostRecipeImage("https://food.example/img/soup.jpg");

    expect(url).toBe(`${R2}/recipe-images/recipe-1.jpg`);
    expect(saveRecipeImage).toHaveBeenCalledWith(JPEG, "jpg");
    const [fetched, init] = mockFetch.mock.calls[0];
    expect(String(fetched)).toBe("https://food.example/img/soup.jpg");
    expect(init.redirect).toBe("manual");
    expect(init.headers.Accept).toMatch(/^image\//);
  });

  it.each([
    ["our CDN", `${R2}/recipe-images/recipe-9.png`],
    ["our disk path", "/api/recipe-images/recipe-9.png"],
  ])("keeps a photo already on %s without fetching", async (_l, url) => {
    expect(await rehostRecipeImage(url)).toBe(url);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null for no photo", async () => {
    expect(await rehostRecipeImage(null)).toBeNull();
    expect(await rehostRecipeImage(undefined)).toBeNull();
    expect(await rehostRecipeImage("")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a local address without fetching", async () => {
    expect(await rehostRecipeImage("http://127.0.0.1/a.jpg")).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a host that resolves to a private address", async () => {
    mockLookup.mockResolvedValue({ address: "10.0.0.5", family: 4 });
    expect(
      await rehostRecipeImage("https://intranet.example/a.jpg"),
    ).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses a redirect to a local address", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1/secret.jpg" },
      }),
    );
    expect(await rehostRecipeImage("https://food.example/a.jpg")).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(saveRecipeImage).not.toHaveBeenCalled();
  });

  it("drops bytes that are not an image", async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(Buffer.from("<html>")));
    expect(await rehostRecipeImage("https://food.example/a.jpg")).toBeNull();
    expect(saveRecipeImage).not.toHaveBeenCalled();
  });

  it("drops an image larger than the cap", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(6 * 1024 * 1024)]);
    mockFetch.mockResolvedValueOnce(imageResponse(big));
    expect(await rehostRecipeImage("https://food.example/a.jpg")).toBeNull();
    expect(saveRecipeImage).not.toHaveBeenCalled();
  });

  it("drops a failed download", async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(Buffer.from(""), 404));
    expect(await rehostRecipeImage("https://food.example/a.jpg")).toBeNull();
  });

  it("drops the photo when storage fails", async () => {
    mockFetch.mockResolvedValueOnce(imageResponse(JPEG));
    vi.mocked(saveRecipeImage).mockRejectedValueOnce(new Error("R2 down"));
    expect(await rehostRecipeImage("https://food.example/a.jpg")).toBeNull();
  });
});
