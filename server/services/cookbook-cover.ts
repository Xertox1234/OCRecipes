import {
  dalleClient,
  OPENAI_TIMEOUT_IMAGE_MS,
  isAiConfigured,
} from "../lib/openai";
import {
  generateImage as runwareGenerateImage,
  isRunwareConfigured,
} from "../lib/runware";
import { saveCookbookCover } from "../lib/image-store";
import { sanitizeUserInput } from "../lib/ai-safety";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("cookbook-cover");

/**
 * Cover art is portrait at book proportion (3:4) to match the cover plate the
 * client renders. Both dimensions are multiples of 64, which the diffusion
 * model requires.
 */
export const COVER_WIDTH = 768;
export const COVER_HEIGHT = 1024;

/** Caps on the user-supplied text folded into the prompt. */
const NAME_PROMPT_MAX = 100;
const DESCRIPTION_PROMPT_MAX = 200;

/**
 * Build the image prompt from a cookbook's name and description.
 *
 * The name and description are user-controlled free text on their way into an
 * AI prompt, so both are run through `sanitizeUserInput` (which strips
 * instruction-injection markers) and hard-truncated before interpolation. The
 * prompt describes a *scene*, never a book cover with type on it — the title
 * is set by the client in real type over the image, so baked-in lettering
 * would collide with it. `runwareGenerateImage`'s default negative prompt
 * already excludes text, watermarks, and letters.
 *
 * Pure and exported for direct testing — the sanitization is the security
 * boundary, so it gets asserted without mocking the image provider.
 */
export function buildCoverPrompt(
  name: string,
  description?: string | null,
): string {
  const safeName = sanitizeUserInput(name).slice(0, NAME_PROMPT_MAX).trim();
  const safeDescription = description
    ? sanitizeUserInput(description).slice(0, DESCRIPTION_PROMPT_MAX).trim()
    : "";

  const subject = safeDescription
    ? `${safeName} — ${safeDescription}`
    : safeName;

  return [
    "Editorial food photography for a cookbook cover.",
    `Theme: ${subject}.`,
    "A styled overhead arrangement of ingredients and finished dishes on a warm",
    "textured surface, natural window light, shallow depth of field, generous",
    "empty space in the upper third for a title, muted earthy palette,",
    "appetizing and premium.",
  ].join(" ");
}

/**
 * Generate a cookbook cover image and persist it. Returns the stored URL, or
 * null when every provider failed or none is configured.
 *
 * Runware is primary, DALL-E 3 the fallback — the same order the recipe hero
 * images use.
 */
export async function generateCookbookCover(
  name: string,
  description?: string | null,
): Promise<string | null> {
  const prompt = buildCoverPrompt(name, description);

  if (isRunwareConfigured) {
    try {
      const buffer = await runwareGenerateImage({
        prompt,
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
      });
      if (buffer) return await saveCookbookCover(buffer);
      log.warn("Runware returned no cover image, falling back to DALL-E");
    } catch (error) {
      log.warn(
        { err: toError(error) },
        "Runware cover generation failed, falling back to DALL-E",
      );
    }
  }

  if (!isAiConfigured) return null;

  try {
    // DALL-E has no separate negative field, so the exclusions ride as a
    // suffix (Runware takes them via its default negative prompt instead).
    // DALL-E 3 has no 3:4 size — 1024x1792 is its portrait option; the client
    // crops to the cover plate.
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt: `${prompt} No text, no watermarks, no logos, no labels, no letters.`,
        n: 1,
        size: "1024x1792",
        quality: "standard",
        response_format: "b64_json",
      },
      { timeout: OPENAI_TIMEOUT_IMAGE_MS },
    );
    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      log.error("DALL-E returned no cover image data");
      return null;
    }
    return await saveCookbookCover(Buffer.from(imageData, "base64"));
  } catch (error) {
    log.error({ err: toError(error) }, "DALL-E cover generation error");
    return null;
  }
}
