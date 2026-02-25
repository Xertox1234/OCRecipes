import type { Express, Request, Response } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { requireAuth } from "../middleware/auth";
import {
  formatZodError,
  checkPremiumFeature,
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
    if (
      allowedTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(m4a|mp4|mp3|wav|aac|ogg)$/i)
    ) {
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
    async (req: Request, res: Response) => {
      try {
        const validated = parseTextSchema.parse(req.body);
        const items = await parseNaturalLanguageFood(validated.text);
        res.json({ items });
      } catch (error) {
        if (error instanceof ZodError) {
          return res.status(400).json({ error: formatZodError(error) });
        }
        console.error("Food parse error:", error);
        res.status(500).json({ error: "Failed to parse food text" });
      }
    },
  );

  // Transcribe audio and parse food
  app.post(
    "/api/food/transcribe",
    requireAuth,
    foodParseRateLimit,
    audioUpload.single("audio"),
    async (req: Request, res: Response) => {
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
          return res.status(400).json({ error: "No audio file provided" });
        }

        const transcription = await transcribeAudio(
          req.file.buffer,
          req.file.originalname,
        );

        if (!transcription.trim()) {
          return res.status(400).json({ error: "Could not transcribe audio" });
        }

        const items = await parseNaturalLanguageFood(transcription);

        res.json({
          transcription,
          items,
        });
      } catch (error) {
        console.error("Voice transcription error:", error);
        res.status(500).json({ error: "Failed to transcribe and parse audio" });
      }
    },
  );
}
