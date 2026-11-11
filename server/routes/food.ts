import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { audioUpload } from "./_upload";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  handleRouteError,
  checkPremiumFeature,
  checkAiConfigured,
  checkAiSharing,
  claimAiCallOrReject,
} from "./_helpers";
import { foodParseRateLimit } from "./_rate-limiters";
import { parseNaturalLanguageFood } from "../services/food-nlp";
import { transcribeAudio } from "../services/voice-transcription";
import { detectAudioMimeType } from "../lib/audio-mime";

const parseTextSchema = z.object({
  text: z.string().min(1).max(1000),
});

/**
 * Privacy audit M3 (owner ruling 2026-11-10): this route sends audio straight
 * to OpenAI, which the app does not name as an AI recipient, and no app code
 * calls it. It answers 404 unless VOICE_TRANSCRIPTION_ENABLED is "true". It
 * runs before the upload parser so no audio is read while the route is off.
 * Turning it on means naming OpenAI first: see server/CLAUDE.md.
 */
function requireVoiceTranscriptionEnabled(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (process.env.VOICE_TRANSCRIPTION_ENABLED === "true") {
    next();
    return;
  }
  sendError(res, 404, "Not found", ErrorCode.NOT_FOUND);
}

export function register(app: Express): void {
  // Parse natural language text to food items
  app.post(
    "/api/food/parse-text",
    requireAuth,
    foodParseRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // Gate AI text parsing behind premium (incurs paid OpenAI calls)
        const features = await checkPremiumFeature(
          req,
          res,
          "textFoodParsing",
          "Text food parsing",
        );
        if (!features) return;

        if (!checkAiConfigured(res)) return;
        if (!(await checkAiSharing(req, res))) return;
        const validated = parseTextSchema.parse(req.body);
        const items = await parseNaturalLanguageFood(validated.text);
        res.json({ items });
      } catch (error) {
        handleRouteError(res, error, "parse food text");
      }
    },
  );

  // Transcribe audio and parse food
  app.post(
    "/api/food/transcribe",
    requireAuth,
    foodParseRateLimit,
    requireVoiceTranscriptionEnabled,
    audioUpload.single("audio"),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        // Check voice logging premium
        const features = await checkPremiumFeature(
          req,
          res,
          "voiceLogging",
          "Voice logging",
        );
        if (!features) return;

        if (!req.file) {
          return sendError(
            res,
            400,
            "No audio file provided",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        if (!checkAiConfigured(res)) return;
        if (!(await checkAiSharing(req, res))) return;

        // Verify audio content via magic bytes (defense-in-depth beyond MIME header)
        const detectedMime = detectAudioMimeType(req.file.buffer);
        if (!detectedMime) {
          return sendError(
            res,
            400,
            "Invalid audio content. File does not match any supported audio format.",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        if (
          !(await claimAiCallOrReject(
            req,
            res,
            "voiceTranscription",
            "voice transcription",
          ))
        )
          return;

        const transcription = await transcribeAudio(
          req.file.buffer,
          req.file.originalname,
        );

        if (!transcription.trim()) {
          return sendError(
            res,
            400,
            "Could not transcribe audio",
            ErrorCode.VALIDATION_ERROR,
          );
        }

        const items = await parseNaturalLanguageFood(transcription);

        res.json({
          transcription,
          items,
        });
      } catch (error) {
        handleRouteError(res, error, "transcribe and parse audio");
      }
    },
  );
}
