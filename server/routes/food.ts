import type { Express, Response } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import {
  formatZodError,
  checkPremiumFeature,
  checkAiConfigured,
  foodParseRateLimit,
} from "./_helpers";
import { parseNaturalLanguageFood } from "../services/food-nlp";
import { transcribeAudio } from "../services/voice-transcription";

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "audio/m4a",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/x-m4a",
      "audio/aac",
      "audio/ogg",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only audio files are accepted."));
    }
  },
});

const parseTextSchema = z.object({
  text: z.string().min(1).max(1000),
});

export function register(app: Express): void {
  // Parse natural language text to food items
  app.post(
    "/api/food/parse-text",
    requireAuth,
    foodParseRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!checkAiConfigured(res)) return;
        const validated = parseTextSchema.parse(req.body);
        const items = await parseNaturalLanguageFood(validated.text);
        res.json({ items });
      } catch (error) {
        if (error instanceof ZodError) {
          return sendError(
            res,
            400,
            formatZodError(error),
            ErrorCode.VALIDATION_ERROR,
          );
        }
        console.error("Food parse error:", error);
        sendError(
          res,
          500,
          "Failed to parse food text",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );

  // Transcribe audio and parse food
  app.post(
    "/api/food/transcribe",
    requireAuth,
    foodParseRateLimit,
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
        console.error("Voice transcription error:", error);
        sendError(
          res,
          500,
          "Failed to transcribe and parse audio",
          ErrorCode.INTERNAL_ERROR,
        );
      }
    },
  );
}
