import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { MulterError } from "multer";
import { createImageUpload, audioUpload } from "../_upload";

// GHSA-535w-7cp7-47q4: a field name like `items[4294967294]` makes multer's
// append-field allocate a max-length sparse array and then iterate it, pinning
// the event loop. multer >= 2.3.0 only closes this when
// `limits.fieldArrayIndexLimit` is set. The clients send plain field names
// (photo, photos, audio, avatar, cover, intent, barcode), so every upload
// sets `fieldNestingDepth: 0` too: no real field name contains `[` at all, so
// no bracket nesting is ever needed. multer checks nesting depth before the
// array-index check, so a bracketed field name — numeric or not — is now
// rejected with `LIMIT_FIELD_NESTING` before `fieldArrayIndexLimit` is even
// consulted; the two tests below still prove the GHSA-535w defense is live
// (the code assertion below is `LIMIT_FIELD_NESTING`, not
// `LIMIT_FIELD_ARRAY_INDEX`, for exactly that reason). A small index keeps
// the test fast: it proves the limits are configured without triggering the
// CPU blow-up itself.

// Mirrors server/routes.ts's MulterError -> 400 mapping.
function appWith(middleware: express.RequestHandler) {
  const app = express();
  app.post("/upload", middleware, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof MulterError) {
      res.status(400).json({ code: err.code });
      return;
    }
    res.sendStatus(500);
  });
  return app;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const M4A = Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);

describe("multipart field-name limits", () => {
  it("image uploads reject a bracketed array index in a field name", async () => {
    const res = await request(
      appWith(createImageUpload(1024 * 1024).single("photo")),
    )
      .post("/upload")
      .field("items[5]", "x")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FIELD_NESTING");
  });

  it("audio uploads reject a bracketed array index in a field name", async () => {
    const res = await request(appWith(audioUpload.single("audio")))
      .post("/upload")
      .field("items[5]", "x")
      .attach("audio", M4A, { filename: "a.m4a", contentType: "audio/m4a" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FIELD_NESTING");
  });

  // Control: the real clients' plain fields still pass. No real request ever
  // sends `intent` and `barcode` together (they're mutually exclusive routes),
  // so this sends only one non-file field to stay a true "real request" control.
  it("still accepts plain field names alongside the file", async () => {
    const res = await request(
      appWith(createImageUpload(1024 * 1024).single("photo")),
    )
      .post("/upload")
      .field("intent", "auto")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(200);
  });

  it("rejects a nested (bracketed, non-numeric) field name", async () => {
    const res = await request(
      appWith(createImageUpload(1024 * 1024).single("photo")),
    )
      .post("/upload")
      .field("a[b]", "x")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FIELD_NESTING");
  });

  it("rejects a second non-file field beyond the `fields` limit", async () => {
    // No real client ever sends two non-file fields in one request (see the
    // control above); this proves the `fields: 1` cap itself, independent of
    // which field names are used.
    const res = await request(
      appWith(createImageUpload(1024 * 1024).single("photo")),
    )
      .post("/upload")
      .field("intent", "auto")
      .field("note", "extra")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FIELD_COUNT");
  });

  it("rejects a 4th file beyond the `files` limit", async () => {
    // maxCount 10 on `.array()` so the per-field cap can't fire first —
    // isolates the shared global `files: 3` limit specifically.
    const res = await request(
      appWith(createImageUpload(1024 * 1024).array("photos", 10)),
    )
      .post("/upload")
      .attach("photos", PNG, { filename: "a.png", contentType: "image/png" })
      .attach("photos", PNG, { filename: "b.png", contentType: "image/png" })
      .attach("photos", PNG, { filename: "c.png", contentType: "image/png" })
      .attach("photos", PNG, { filename: "d.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIMIT_FILE_COUNT");
  });

  // Control: the largest real request across all routes — /api/receipt/scan's
  // 3 photos (client/hooks/useReceiptScan.ts) combined with the largest
  // single-field case (intent/barcode) — still passes under every new limit
  // at once. No single route actually combines both maxima; this proves the
  // limits don't interact to reject something smaller than either bound.
  it("still accepts the largest real request (3 files + 1 field)", async () => {
    const res = await request(
      appWith(createImageUpload(1024 * 1024).array("photos", 3)),
    )
      .post("/upload")
      .field("intent", "auto")
      .attach("photos", PNG, { filename: "a.png", contentType: "image/png" })
      .attach("photos", PNG, { filename: "b.png", contentType: "image/png" })
      .attach("photos", PNG, { filename: "c.png", contentType: "image/png" });

    expect(res.status).toBe(200);
  });
});
