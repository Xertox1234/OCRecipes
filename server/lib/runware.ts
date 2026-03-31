import { logger } from "./logger";

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

/**
 * Generate an image using Runware's FLUX.1 Schnell model.
 * Returns the image as a Buffer, or null on failure.
 */
export async function generateImage(prompt: string): Promise<Buffer | null> {
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
          positivePrompt: prompt,
          width: 1024,
          height: 1024,
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

    const body = (await response.json()) as { data: RunwareImageResult[] };
    const imageData = body.data?.[0]?.imageBase64Data;

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
