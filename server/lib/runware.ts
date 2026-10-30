import crypto from "node:crypto";
import { logger } from "./logger";
import { saveRecipeImage } from "./image-store";
import { detectImageMimeType } from "./image-mime";
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
  /**
   * Request a specific Runware output format. Omitted by default — Runware's
   * own default is JPEG (see docs/solutions/conventions/runware-imageinference-defaults-to-jpeg-without-outputformat-2026-09-29.md).
   * Pass "PNG" only when the caller actually needs real PNG bytes (e.g. an
   * app-icon asset written to a `.png` path); do not default this globally.
   */
  outputFormat?: "PNG";
}

/**
 * Decode Runware's base64 payload and verify it is a real image by magic
 * bytes. `Buffer.from(_, "base64")` never throws, so a 200 carrying error
 * text or truncated data would otherwise be stored as a permanently broken
 * recipe/cookbook image; returning null lets callers fall back instead.
 */
function decodeImageOrNull(base64: string, op: string): Buffer | null {
  const buffer = Buffer.from(base64, "base64");
  if (!detectImageMimeType(buffer)) {
    logger.error(
      { op, bytes: buffer.length },
      "Runware returned a payload that is not a recognised image",
    );
    return null;
  }
  return buffer;
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
          ...(options.outputFormat
            ? { outputFormat: options.outputFormat }
            : {}),
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

    return decodeImageOrNull(imageData, "image generation");
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

    return decodeImageOrNull(imageData, "background removal");
  } catch (error) {
    logger.error({ err: error }, "Runware background removal error");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Persist a generated image Buffer (delegates to the image-store, which writes
 * to R2 in production and disk in dev). Returns the stored URL.
 *
 * `ext` must match the actual bytes of `buffer` — pass it explicitly whenever
 * the caller knows the provider returned something other than
 * saveRecipeImage's "png" default (e.g. Runware without `outputFormat`, which
 * returns JPEG). Omit it only when the bytes really are PNG.
 */
export async function saveImageBuffer(
  buffer: Buffer,
  ext?: NonNullable<Parameters<typeof saveRecipeImage>[1]>,
): Promise<string> {
  return saveRecipeImage(buffer, ext);
}
