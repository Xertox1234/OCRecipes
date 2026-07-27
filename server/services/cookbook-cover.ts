import { z } from "zod";

import {
  openai,
  dalleClient,
  MODEL_FAST,
  OPENAI_TIMEOUT_FAST_MS,
  OPENAI_TIMEOUT_IMAGE_MS,
  isAiConfigured,
} from "../lib/openai";
import {
  generateImage as runwareGenerateImage,
  isRunwareConfigured,
} from "../lib/runware";
import { saveCookbookCover } from "../lib/image-store";
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";
import { isArtDirectorLLMEnabled } from "./image-art-direction";
import { createServiceLogger, toError } from "../lib/logger";

const log = createServiceLogger("cookbook-cover");

/**
 * Cover art is portrait at book proportion (3:4) to match the cover plate the
 * client renders. Both dimensions are multiples of 64, which the diffusion
 * model requires.
 */
export const COVER_WIDTH = 768;
export const COVER_HEIGHT = 1024;

/** Caps on the user-supplied text folded into the LLM pre-pass. */
const NAME_PROMPT_MAX = 100;
const DESCRIPTION_PROMPT_MAX = 200;
/** Cap on the derived subject folded into the image prompt. */
const SUBJECT_PROMPT_MAX = 200;

/**
 * Extra negative terms on top of the provider default.
 *
 * The default already lists `text, watermark, logo, label, letters, words`,
 * and that was NOT enough on its own — see `buildCoverPrompt` for why. These
 * cover the surfaces a food scene actually carries writing on.
 */
const COVER_NEGATIVE_PROMPT =
  "text, lettering, writing, words, letters, title, caption, typography, " +
  "handwriting, watermark, logo, label, signage, book cover, magazine cover, " +
  "packaging, printed packaging, chalkboard, recipe card, blurry, " +
  "out of focus, oversaturated, artificial colors, cartoon, illustration, " +
  "3d render";

/**
 * Scene used when no LLM is available to derive one from the cookbook's name.
 * Deliberately generic and made only of food nouns — nothing here reads as a
 * name the image model could letter.
 */
export const FALLBACK_COVER_SUBJECT =
  "an assortment of home-cooked dishes and fresh ingredients";

const CoverSubjectSchema = z.object({
  subject: z.string().min(1).max(200),
});

/**
 * Build the image prompt from an already-derived food SUBJECT.
 *
 * `subject` must be a plain food-scene description — never the cookbook's
 * name. See `deriveCoverSubject` for why that separation exists.
 *
 * The prompt also never frames the image as a cover with a title on it. That
 * framing is load-bearing, not stylistic: an earlier version opened with
 * "Editorial food photography for a cookbook cover" and asked for "empty
 * space in the upper third for a title", and the model duly rendered the
 * cookbook's name across the top in large type. Current diffusion models
 * render text well enough that a negative-prompt term is a weight, not a
 * veto. The client sets the title in real type over the image, so any
 * baked-in lettering is a collision. Do not reintroduce the words "cover",
 * "title", or "space for text" here.
 *
 * Pure and exported for direct testing — the no-titling-cues property is a
 * correctness one, so it is asserted without mocking the image provider.
 */
export function buildCoverPrompt(subject: string): string {
  const safeSubject =
    sanitizeUserInput(subject).slice(0, SUBJECT_PROMPT_MAX).trim() ||
    FALLBACK_COVER_SUBJECT;

  return [
    `Overhead food photography of ${safeSubject}.`,
    "A styled arrangement on a warm textured surface, shot from directly",
    "above in soft natural window light. Shallow depth of field, muted earthy",
    "palette, appetizing and premium. Uncluttered negative space in the upper",
    "third of the frame. Every surface is plain and unmarked.",
  ].join(" ");
}

/**
 * Turn a cookbook's name and description into a food-scene description.
 *
 * This exists because the cookbook's NAME cannot go into the image prompt.
 * A recipe title names a dish, so an image model renders the food ("Chicken
 * Parmesan" → a plate of chicken parmesan). A cookbook name is a branding
 * phrase with no depictable referent, so the model falls back to rendering it
 * as lettering — verified twice against Runware with "Sunday Bakes", which
 * came back with the words set across the top in display type (and, on the
 * second attempt, additional garbled lettering along the bottom). Removing
 * every titling cue from the prompt was not sufficient; the name itself is
 * the trigger.
 *
 * So the name never reaches the image model. This pre-pass maps it to
 * concrete food nouns first, mirroring the `resolveArtDirection` LLM pre-pass
 * used for recipe hero images: same fail-soft contract (any error, missing
 * config, or invalid response falls back to a deterministic value) and the
 * same `IMAGE_ART_DIRECTOR_LLM=off` kill switch.
 */
export async function deriveCoverSubject(
  name: string,
  description?: string | null,
): Promise<string> {
  if (!isArtDirectorLLMEnabled()) return FALLBACK_COVER_SUBJECT;

  const safeName = sanitizeUserInput(name).slice(0, NAME_PROMPT_MAX).trim();
  const safeDescription = description
    ? sanitizeUserInput(description).slice(0, DESCRIPTION_PROMPT_MAX).trim()
    : "unspecified";

  try {
    const systemPrompt =
      "You turn a cookbook's name into a description of the FOOD it contains, " +
      "for a photographer who will never see the name. Reply with concrete " +
      "dishes and ingredients only. Never repeat the cookbook's name, any " +
      "proper noun, any brand, or any word that is not a food, utensil, or " +
      "cooking term — the description is fed to an image model that will " +
      "render any name it sees as written text on the photograph.\n" +
      SYSTEM_PROMPT_BOUNDARY;

    const userPrompt =
      `Cookbook name: "${safeName}"\n` +
      `Cookbook description: ${safeDescription}\n\n` +
      `Return JSON: {"subject": "..."} where subject is a single noun phrase ` +
      `under 25 words naming 3-5 specific dishes or ingredients that belong ` +
      `in this cookbook. Example: {"subject": "golden pastries, a berry tart, ` +
      `and bowls of flour and sugar"}.`;

    const completion = await openai.chat.completions.create(
      {
        model: MODEL_FAST,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 120,
        response_format: { type: "json_object" },
      },
      { timeout: OPENAI_TIMEOUT_FAST_MS },
    );

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return FALLBACK_COVER_SUBJECT;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return FALLBACK_COVER_SUBJECT;
    }

    const validated = CoverSubjectSchema.safeParse(parsed);
    if (!validated.success) {
      log.warn(
        { issues: validated.error.issues },
        "cover-subject LLM response failed validation; using fallback",
      );
      return FALLBACK_COVER_SUBJECT;
    }

    const subject = validated.data.subject
      .replace(/[\r\n"]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // Last-ditch guard: if the model echoed the cookbook name back despite
    // being told not to, the name would reach the image model after all.
    if (
      safeName.length > 2 &&
      subject.toLowerCase().includes(safeName.toLowerCase())
    ) {
      log.warn("cover-subject LLM echoed the cookbook name; using fallback");
      return FALLBACK_COVER_SUBJECT;
    }

    return subject || FALLBACK_COVER_SUBJECT;
  } catch (err) {
    log.warn(
      { err: toError(err) },
      "cover-subject LLM call failed; using fallback",
    );
    return FALLBACK_COVER_SUBJECT;
  }
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
  // The name is mapped to food nouns FIRST and never reaches the image model
  // — see `deriveCoverSubject`.
  const prompt = buildCoverPrompt(await deriveCoverSubject(name, description));

  if (isRunwareConfigured) {
    try {
      const buffer = await runwareGenerateImage({
        prompt,
        negativePrompt: COVER_NEGATIVE_PROMPT,
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
