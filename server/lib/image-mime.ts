/**
 * Detect image MIME type from file content magic bytes.
 *
 * This avoids trusting the client-provided Content-Type header,
 * which can be trivially forged. Instead we inspect the first bytes
 * of the buffer for well-known signatures.
 *
 * Supported formats: JPEG, PNG, WebP.
 */

const SIGNATURES: { mime: string; check: (buf: Buffer) => boolean }[] = [
  {
    mime: "image/jpeg",
    // JPEG starts with FF D8 FF
    check: (buf) =>
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: "image/png",
    // PNG starts with 89 50 4E 47 (magic: \x89PNG)
    check: (buf) =>
      buf.length >= 4 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47,
  },
  {
    mime: "image/webp",
    // WebP: starts with RIFF (52 49 46 46) and has WEBP (57 45 42 50) at offset 8
    check: (buf) =>
      buf.length >= 12 &&
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50,
  },
];

/**
 * Inspect the magic bytes of a buffer and return the detected MIME type,
 * or `null` if the content does not match any supported image format.
 */
export function detectImageMimeType(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    if (sig.check(buffer)) {
      return sig.mime;
    }
  }
  return null;
}
