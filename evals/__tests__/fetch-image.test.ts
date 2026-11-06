import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { fetchImageAsJpegBase64 } from "../lib/fetch-image";

async function pngOf(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: "#ff0000" },
  })
    .png()
    .toBuffer();
}

function stubFetch(body: Buffer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(body), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchImageAsJpegBase64", () => {
  it("bounds the longer edge to the app's upload size, keeping the aspect ratio", async () => {
    stubFetch(await pngOf(3000, 1500));
    const b64 = await fetchImageAsJpegBase64("https://example.test/wide.png", {
      maxEdge: 1536,
      quality: 85,
    });
    const meta = await sharp(Buffer.from(b64, "base64")).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1536);
    expect(meta.height).toBe(768);
  });

  it("never enlarges a photo smaller than the bound", async () => {
    stubFetch(await pngOf(800, 600));
    const b64 = await fetchImageAsJpegBase64("https://example.test/small.png", {
      maxEdge: 1024,
      quality: 80,
    });
    const meta = await sharp(Buffer.from(b64, "base64")).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it("caches per url and size, so two upload sizes of one photo stay distinct", async () => {
    stubFetch(await pngOf(2000, 2000));
    const url = "https://example.test/square.png";
    const big = await fetchImageAsJpegBase64(url, {
      maxEdge: 1536,
      quality: 85,
    });
    const small = await fetchImageAsJpegBase64(url, {
      maxEdge: 1024,
      quality: 80,
    });
    expect((await sharp(Buffer.from(big, "base64")).metadata()).width).toBe(
      1536,
    );
    expect((await sharp(Buffer.from(small, "base64")).metadata()).width).toBe(
      1024,
    );
  });

  it("applies the EXIF orientation, as the app's image manipulator does", async () => {
    // A landscape 600x300 JPEG tagged "rotate 90 degrees" is a portrait photo.
    const tagged = await sharp({
      create: { width: 600, height: 300, channels: 3, background: "#00ff00" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    stubFetch(tagged);
    const b64 = await fetchImageAsJpegBase64("https://example.test/exif.jpg", {
      maxEdge: 1536,
      quality: 85,
    });
    const meta = await sharp(Buffer.from(b64, "base64")).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(600);
  });
});
