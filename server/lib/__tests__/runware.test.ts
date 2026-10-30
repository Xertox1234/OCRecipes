import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const saveRecipeImageMock = vi.fn().mockResolvedValue("https://cdn.test/x.jpg");
vi.mock("../image-store", () => ({
  saveRecipeImage: saveRecipeImageMock,
}));

/** JPEG magic bytes (FF D8 FF) + filler — passes detectImageMimeType. */
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

/** A minimal-but-valid Runware imageInference response. */
function fetchOkWithImage(imageBase64Data = JPEG_BYTES.toString("base64")) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ taskType: "imageInference", imageBase64Data }],
    }),
  });
}

/** The module reads `RUNWARE_API_KEY` at import time, so every test needs a
 * fresh module instance loaded after the env var is set (mirrors
 * image-store.test.ts's `load()` pattern for its own module-level reads). */
async function load() {
  vi.resetModules();
  return await import("../runware");
}

const PRIOR_API_KEY = process.env.RUNWARE_API_KEY;

describe("runware", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    saveRecipeImageMock.mockReset().mockResolvedValue("https://cdn.test/x.jpg");
    process.env.RUNWARE_API_KEY = "test-key";
  });

  afterEach(() => {
    if (PRIOR_API_KEY === undefined) delete process.env.RUNWARE_API_KEY;
    else process.env.RUNWARE_API_KEY = PRIOR_API_KEY;
  });

  describe("generateImage — outputFormat passthrough", () => {
    it("omits outputFormat by default, leaving Runware's own default (JPEG) in effect", async () => {
      fetchOkWithImage();
      const { generateImage } = await load();

      await generateImage({ prompt: "a bowl of soup" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as unknown[];
      expect(body[0]).not.toHaveProperty("outputFormat");
    });

    it("requests a real PNG when outputFormat: 'PNG' is passed", async () => {
      fetchOkWithImage();
      const { generateImage } = await load();

      await generateImage({ prompt: "an app icon", outputFormat: "PNG" });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body) as {
        outputFormat?: string;
      }[];
      expect(body[0].outputFormat).toBe("PNG");
    });
  });

  describe("decoded image validation (R38)", () => {
    it("returns null when the decoded payload is not a real image", async () => {
      fetchOkWithImage(Buffer.from("upstream error text").toString("base64"));
      const { generateImage } = await load();
      expect(await generateImage({ prompt: "soup" })).toBeNull();
    });

    it("returns the buffer when the payload is a recognised image", async () => {
      fetchOkWithImage();
      const { generateImage } = await load();
      const buf = await generateImage({ prompt: "soup" });
      expect(buf).toEqual(JPEG_BYTES);
    });

    it("removeBackground returns null for a non-image payload", async () => {
      fetchOkWithImage(Buffer.from("not a png").toString("base64"));
      const { removeBackground } = await load();
      expect(await removeBackground(JPEG_BYTES)).toBeNull();
    });
  });

  describe("saveImageBuffer — ext passthrough", () => {
    it("passes the given ext straight through to saveRecipeImage", async () => {
      const { saveImageBuffer } = await load();
      const buffer = Buffer.from("bytes");

      await saveImageBuffer(buffer, "jpg");

      expect(saveRecipeImageMock).toHaveBeenCalledWith(buffer, "jpg");
    });

    it("passes no ext when the caller omits it, keeping saveRecipeImage's own default", async () => {
      const { saveImageBuffer } = await load();
      const buffer = Buffer.from("bytes");

      await saveImageBuffer(buffer);

      expect(saveRecipeImageMock).toHaveBeenCalledWith(buffer, undefined);
    });
  });
});
