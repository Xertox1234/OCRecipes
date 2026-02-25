import { detectImageMimeType } from "../image-mime";

describe("detectImageMimeType", () => {
  it("detects JPEG from magic bytes", () => {
    // JPEG starts with FF D8 FF
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageMimeType(buf)).toBe("image/jpeg");
  });

  it("detects PNG from magic bytes", () => {
    // PNG starts with 89 50 4E 47 0D 0A 1A 0A
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectImageMimeType(buf)).toBe("image/png");
  });

  it("detects WebP from magic bytes", () => {
    // WebP: RIFF....WEBP
    const buf = Buffer.alloc(12);
    buf.write("RIFF", 0, "ascii"); // bytes 0-3
    buf.writeUInt32LE(0, 4); // file size placeholder (bytes 4-7)
    buf.write("WEBP", 8, "ascii"); // bytes 8-11
    expect(detectImageMimeType(buf)).toBe("image/webp");
  });

  it("returns null for unrecognized content", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it("returns null for empty buffer", () => {
    const buf = Buffer.alloc(0);
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it("returns null for buffer too short for any signature", () => {
    const buf = Buffer.from([0xff, 0xd8]); // only 2 bytes, JPEG needs 3
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it("returns null for GIF (unsupported format)", () => {
    // GIF starts with 47 49 46 38 (GIF8)
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it("returns null for PDF masquerading as image", () => {
    // PDF starts with %PDF (25 50 44 46)
    const buf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(detectImageMimeType(buf)).toBeNull();
  });

  it("returns null for RIFF container that is not WebP", () => {
    // RIFF....AVI  (not WEBP at offset 8)
    const buf = Buffer.alloc(12);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(0, 4);
    buf.write("AVI ", 8, "ascii");
    expect(detectImageMimeType(buf)).toBeNull();
  });
});
