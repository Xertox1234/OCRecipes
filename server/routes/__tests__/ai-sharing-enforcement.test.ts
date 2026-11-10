import { describe, it, expect, vi, beforeEach } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";

import {
  requestContextMiddleware,
  setRequestUserId,
} from "../../lib/request-context";
import {
  assertAiSharingAllowed,
  installAiSharingLookup,
  resetAiSharingGateForTests,
} from "../../lib/ai-sharing-gate";
import { analyzePhoto } from "../../services/photo-analysis";
import { handleRouteError } from "../_helpers";
import { upload } from "../_upload";
import { register as registerPhotos } from "../photos";

// Privacy audit H3, end to end through the real middleware chain: request
// context → sign-in → multipart upload → route. The other route tests run
// without a request context and with a user who allows AI sharing, so they
// cannot see whether a refusal survives this chain.

vi.mock("../../storage", () => ({
  storage: {
    getDailyScanCount: vi.fn().mockResolvedValue(0),
    getSubscriptionStatus: vi.fn().mockResolvedValue({ tier: "premium" }),
    getEffectiveTierForUser: vi.fn().mockResolvedValue("premium"),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../lib/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/openai")>()),
  isAiConfigured: true,
}));
vi.mock("../../services/photo-analysis", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/photo-analysis")>()),
  analyzePhoto: vi.fn(),
}));
// Signs in like the real requireAuth: the request's own user AND the request
// context's user.
vi.mock("../../middleware/auth", () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.userId = "user-1";
    setRequestUserId("user-1");
    next();
  },
}));

// A 1x1 PNG: passes the magic-byte check.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    (req as Request & { id: string }).id = "req-1";
    next();
  });
  app.use(requestContextMiddleware);
  registerPhotos(app);
  // Stands in for any route whose only check is the one inside aiChat.
  app.post(
    "/test/ai-call-after-upload",
    (req: Request, _res: Response, next: NextFunction) => {
      req.userId = "user-1";
      setRequestUserId("user-1");
      next();
    },
    upload.single("photo"),
    async (_req: Request, res: Response) => {
      try {
        await assertAiSharingAllowed();
        res.json({ sent: true });
      } catch (error) {
        handleRouteError(res, error, "analyze");
      }
    },
  );
  return app;
}

describe("AI-sharing permission through the real request chain", () => {
  const lookup = vi.fn<(userId: string) => Promise<boolean>>();

  beforeEach(() => {
    resetAiSharingGateForTests();
    installAiSharingLookup(lookup);
    lookup.mockReset().mockResolvedValue(false);
    vi.mocked(analyzePhoto).mockReset();
  });

  it("refuses a photo scan for a user with AI off, before any analysis", async () => {
    const res = await request(createApp())
      .post("/api/photos/analyze")
      .attach("photo", PNG, { filename: "meal.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_SHARING_REQUIRED");
    expect(lookup).toHaveBeenCalledWith("user-1");
    expect(analyzePhoto).not.toHaveBeenCalled();
  });

  it("the check inside the AI call still knows the user after a multipart upload", async () => {
    const res = await request(createApp())
      .post("/test/ai-call-after-upload")
      .attach("photo", PNG, { filename: "meal.png", contentType: "image/png" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AI_SHARING_REQUIRED");
  });

  it("control: the same upload goes through once the user allows AI sharing", async () => {
    lookup.mockResolvedValue(true);

    const res = await request(createApp())
      .post("/test/ai-call-after-upload")
      .attach("photo", PNG, { filename: "meal.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: true });
  });
});
