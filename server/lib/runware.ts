import { logger } from "./logger";
import { z } from "zod";

const RUNWARE_API_URL = "https://api.runware.ai/v1";
const RUNWARE_TIMEOUT_MS = 60_000;

const apiKey = process.env.RUNWARE_API_KEY;
if (!apiKey) {
  logger.warn("RUNWARE_API_KEY not set — Runware image generation unavailable");
}

/** Whether Runware API is configured */
export const isRunwareConfigured = !!apiKey;

interface RunwareImageResult {
  taskType: string;
  imageBase64Data?: string;
  imageURL?: string;
}

const runwareResponseSchema = z.object({
  data: z.array(
    z.object({
      taskType: z.string(),
      imageBase64Data: z.string().optional(),
      imageURL: z.string().optional(),
    }),
  ),
});

const DEFAULT_NEGATIVE_PROMPT =
  "text, watermark, logo, label, letters, words, blurry, out of focus, oversaturated, artificial colors, cartoon, illustration, 3d render";

export interface GenerateImageOptions {
  prompt: string;
  negativePrompt?: string;
}

/**
 * Generate an image using Runware's FLUX.1 Schnell model.
 * Returns the image as a Buffer, or null on failure.
 */
export async function generateImage(
  options: GenerateImageOptions,
): Promise<Buffer | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNWARE_TIMEOUT_MS);

  try {
    const response = await fetch(RUNWARE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify([
        {
          taskType: "imageInference",
          taskUUID: crypto.randomUUID(),
          model: "runware:100@1",
          positivePrompt: options.prompt,
          negativePrompt: options.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
          width: 512,
          height: 512,
          outputType: "base64Data",
          numberResults: 1,
        },
      ]),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Runware API returned error status",
      );
      return null;
    }

    const raw = await response.json();
    const parsed = runwareResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { zodErrors: parsed.error.flatten() },
        "Runware response validation failed",
      );
      return null;
    }
    const imageData = parsed.data.data[0]?.imageBase64Data;

    if (!imageData) {
      logger.error("Runware returned no image data");
      return null;
    }

    return Buffer.from(imageData, "base64");
  } catch (error) {
    logger.error({ err: error }, "Runware image generation error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
