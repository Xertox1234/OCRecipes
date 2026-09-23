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
// (photo, photos, audio, intent, barcode), so every upload rejects any
// bracketed array index. A small index keeps the test fast: it proves the
// limit is configured without triggering the CPU blow-up itself.

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
    expect(res.body.code).toMatch(/^LIMIT_/);
  });

  it("audio uploads reject a bracketed array index in a field name", async () => {
    const res = await request(appWith(audioUpload.single("audio")))
      .post("/upload")
      .field("items[5]", "x")
      .attach("audio", M4A, { filename: "a.m4a", contentType: "audio/m4a" });

    expect(res.status).toBe(400);
    expect(res.body.code).toMatch(/^LIMIT_/);
  });

  // Control: the real clients' plain fields still pass.
  it("still accepts plain field names alongside the file", async () => {
    const res = await request(
      appWith(createImageUpload(1024 * 1024).single("photo")),
    )
      .post("/upload")
      .field("intent", "auto")
      .field("barcode", "0778918011332")
      .attach("photo", PNG, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(200);
  });
});
