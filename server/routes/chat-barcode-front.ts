/**
 * POST /api/chat/conversations/:id/barcode-front — the Coach scanner's
 * optional third step: a barcode, the nutrition label the phone read, and a
 * photo of the front of the pack. The scanner sends it only when the
 * barcode gives no usable name (an unknown product, a lookup outage, or a
 * label that doesn't fit the product). The AI model reads the front for the
 * product's name and the allergen statements printed on it; the photo is
 * read in memory and never stored.
 *
 * Multipart: the `photo` file and one form field, `scan`, a JSON string of
 * `{ barcode, label, openingBrief? }` (server/routes/_upload.ts allows one
 * field). Unlike the other phone-read turns a model reads this one, so it
 * needs AI sharing allowed and spends a photo credit.
 */
import type { Express, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { rejectOverlappingChatTurn } from "../lib/in-flight";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  checkAiConfigured,
  checkAiSharing,
  formatZodError,
  handleRouteError,
  requireValidImage,
} from "./_helpers";
import { ipKeyGenerator, resolveRateLimitMax } from "./_rate-limiters";
import { upload } from "./_upload";
import { COACH_BARCODE_USER_TEXT } from "../services/coach-photo";
import { scannedBarcodeFrontReply } from "../services/coach-scan-reply";
import {
  answerPhoneRead,
  barcodeBodySchema,
  labelReadSchema,
} from "./chat-barcode";

const PHOTO_CAP_TEXT =
  "You've reached today's photo limit. Tell me what you ate and I'll log it for you.";

// The front alone carries no numbers, so the label is required here.
const frontScanSchema = barcodeBodySchema.extend({ label: labelReadSchema });

/** The `scan` form field, parsed; null when it is not JSON. */
function parseScanField(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const fieldsSchema = z.object({ scan: z.string().max(2000) }).strict();

export function register(app: Express): void {
  app.post(
    "/api/chat/conversations/:id/barcode-front",
    requireAuth,
    // Inline, not the photoRateLimit factory const: CodeQL's
    // js/missing-rate-limiting query cannot trace the factory. Same limits
    // as the chat's photo route: 10/min, keyed by user with the IP fallback.
    rateLimit({
      windowMs: 60 * 1000,
      max: resolveRateLimitMax(10, process.env),
      message: {
        error: "Too many photo uploads. Please wait.",
        code: ErrorCode.RATE_LIMITED,
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => req.userId || ipKeyGenerator(req),
    }),
    // Before the upload is read: a refused turn costs nothing.
    rejectOverlappingChatTurn,
    upload.single("photo"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const fields = fieldsSchema.safeParse(req.body ?? {});
        const body = frontScanSchema.safeParse(
          fields.success ? parseScanField(fields.data.scan) : null,
        );
        if (!body.success)
          return sendError(
            res,
            400,
            formatZodError(body.error),
            ErrorCode.VALIDATION_ERROR,
          );

        if (!checkAiConfigured(res)) return;
        if (!(await checkAiSharing(req, res))) return;

        const imageBase64 = requireValidImage(req, res);
        if (!imageBase64) return;

        const { barcode, label, openingBrief } = body.data;
        await answerPhoneRead(req, res, openingBrief, {
          userText: COACH_BARCODE_USER_TEXT,
          capKind: "photoAnalysis",
          capText: PHOTO_CAP_TEXT,
          photo: true,
          featureName: "Photos in Coach chat",
          failedText:
            "I couldn't read that pack just now. Please scan it again.",
          cardFailedText:
            "I read your pack but couldn't make the card just now. Please scan it again.",
          noun: "Barcodes",
          logLabel: "barcode front read",
          reply: (ctx) =>
            scannedBarcodeFrontReply(barcode, imageBase64, ctx, label),
        });
      } catch (error) {
        handleRouteError(res, error, "send coach barcode front");
      }
    },
  );
}
