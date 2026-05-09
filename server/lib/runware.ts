import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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

/** FLUX.2 klein 9B KV — default model (cheap, fast) */
export const RUNWARE_MODEL_STANDARD = "runware:400@6";
/** FLUX.1 dev — higher quality, used for curated/canonical recipes */
export const RUNWARE_MODEL_HQ = "runware:101@1";

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
  width?: number;
  height?: number;
  model?: string;
}

/**
 * Generate an image using Runware's FLUX.2 [klein] 9B KV model.
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
          model: options.model ?? RUNWARE_MODEL_STANDARD,
          positivePrompt: options.prompt,
          negativePrompt: options.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
          width: options.width ?? 1024,
          height: options.height ?? 1024,
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

/**
 * Remove the background from an image using Runware's AI segmentation.
 * Returns a transparent-background PNG as a Buffer, or null on failure.
 */
export async function removeBackground(
  imageBuffer: Buffer,
): Promise<Buffer | null> {
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNWARE_TIMEOUT_MS);

  try {
    const inputBase64 = imageBuffer.toString("base64");

    const response = await fetch(RUNWARE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify([
        {
          taskType: "imageBackgroundRemoval",
          taskUUID: crypto.randomUUID(),
          inputImage: inputBase64,
          outputType: "base64Data",
          outputFormat: "PNG",
        },
      ]),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(
        { status: response.status },
        "Runware background removal returned error status",
      );
      return null;
    }

    const raw = await response.json();
    const parsed = runwareResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.error(
        { zodErrors: parsed.error.flatten() },
        "Runware background removal response validation failed",
      );
      return null;
    }

    const imageData = parsed.data.data[0]?.imageBase64Data;
    if (!imageData) {
      logger.error("Runware background removal returned no image data");
      return null;
    }

    return Buffer.from(imageData, "base64");
  } catch (error) {
    logger.error({ err: error }, "Runware background removal error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const IMAGES_DIR = path.join(process.cwd(), "uploads", "recipe-images");
const MAX_IMAGE_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Save an image Buffer to uploads/recipe-images/ and return the API URL path.
 * Throws if the buffer exceeds the 10 MB size limit.
 */
export async function saveImageBuffer(buffer: Buffer): Promise<string> {
  if (buffer.length > MAX_IMAGE_BUFFER_SIZE) {
    throw new Error(`Image too large: ${buffer.length} bytes`);
  }
  await fs.promises.mkdir(IMAGES_DIR, { recursive: true });
  const filename = `recipe-${crypto.randomUUID()}.png`;
  await fs.promises.writeFile(path.join(IMAGES_DIR, filename), buffer);
  return `/api/recipe-images/${filename}`;
}
