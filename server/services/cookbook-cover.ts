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
const COVER_SURFACE_NEGATIVES =
  "text, lettering, writing, words, letters, title, caption, typography, " +
  "handwriting, watermark, logo, label, signage, book cover, magazine cover, " +
  "packaging, printed packaging, chalkboard, recipe card";

const COVER_NEGATIVE_PROMPT =
  `${COVER_SURFACE_NEGATIVES}, blurry, out of focus, oversaturated, ` +
  "artificial colors, cartoon, illustration, 3d render";

/**
 * Nouns that are themselves lettering surfaces. Used two ways: rejected if the
 * LLM pre-pass smuggles one into the derived subject, and (via
 * `COVER_SURFACE_NEGATIVES`) excluded on both provider paths.
 *
 * `cookbook` is listed separately from `book` on purpose — `\bbooks?\b` does
 * NOT match "cookbook", because `\b` needs a word/non-word transition and
 * `k`→`b` is word→word. That is the single likeliest leaked noun here, so
 * relying on the `book` entry alone would miss exactly the case that matters.
 */
const SURFACE_NOUN_RE =
  /\b(?:cook)?books?\b|\bcovers?\b|\btitles?\b|\btext\b|\bletter(?:s|ing)?\b|\bwords?\b|\bwriting\b|\blabels?\b|\bsigns?\b|\bsignage\b|\bchalkboards?\b|\bmenus?\b|\bpackaging\b|\bposters?\b|\bmagazines?\b|\bnewspapers?\b|\brecipe cards?\b/i;

/** Words in a whitespace-separated phrase. */
export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Casefold + drop punctuation + collapse whitespace, for echo comparison. */
function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Whether the derived subject echoes the cookbook's name.
 *
 * Compares NORMALIZED forms so a paraphrase can't slip through on punctuation
 * or spacing alone, and accepts a partial echo: if most of the name's
 * significant words reappear, it is still recognisably the branding phrase and
 * must not reach the image model. Names of 1-2 characters are skipped — they
 * match inside almost any subject and would reject every valid result.
 *
 * Exported for direct testing: this is the guard on the defect the whole
 * service exists to prevent.
 */
export function echoesName(subject: string, name: string): boolean {
  const normName = normalizeForEcho(name);
  if (normName.length <= 2) return false;

  const normSubject = normalizeForEcho(subject);
  if (normSubject.includes(normName)) return true;

  // Partial echo: ignore short filler words, then require a majority of the
  // name's remaining words to appear as whole words in the subject.
  const nameWords = normName.split(" ").filter((w) => w.length > 2);
  if (nameWords.length === 0) return false;
  const subjectWords = new Set(normSubject.split(" "));
  const hits = nameWords.filter((w) => subjectWords.has(w)).length;
  return hits / nameWords.length > 0.5;
}

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

  // Inside the try: the doc comment above promises every failure falls back,
  // and a throw out here would escape to the route as a 500 instead.
  try {
    const safeName = sanitizeUserInput(name).slice(0, NAME_PROMPT_MAX).trim();
    const safeDescription = description
      ? sanitizeUserInput(description).slice(0, DESCRIPTION_PROMPT_MAX).trim()
      : "unspecified";

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
        max_completion_tokens: 120,
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

    // The system prompt asks the model for food nouns only, but that is a soft
    // instruction — the same "weight, not a veto" failure this whole service
    // exists to work around, one level upstream. So the OUTPUT is constrained
    // too, and every rejection falls back to the deterministic subject.

    // 1. Charset + length. Blocks control tokens, fake turn markers, and
    //    "Return JSON: {...}" restatements that a steered description could
    //    push through the ~200 chars of free-form text it controls.
    if (!/^[A-Za-z0-9 ,.'-]+$/.test(subject) || wordCount(subject) > 25) {
      log.warn("cover-subject LLM output failed shape check; using fallback");
      return FALLBACK_COVER_SUBJECT;
    }

    // 2. No lettering surfaces. "a chalkboard menu and a stack of cookbooks"
    //    is well-formed food-adjacent prose that would put writing right back
    //    into the image.
    if (SURFACE_NOUN_RE.test(subject)) {
      log.warn(
        "cover-subject LLM output named a lettering surface; using fallback",
      );
      return FALLBACK_COVER_SUBJECT;
    }

    // 3. No echo of the cookbook name — the original failure mode. Both sides
    //    are normalized (punctuation dropped, whitespace collapsed, casefolded)
    //    because the model paraphrases: "Grandma's Kitchen" comes back as
    //    "Grandmas Kitchen" and a raw substring test would miss it. Also
    //    rejects a PARTIAL echo, since "Sunday Bakes" out of "Sunday Bakes Vol
    //    2" is still the branding phrase.
    if (echoesName(subject, safeName)) {
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
    // suffix. This suffix is therefore the ONLY lettering gate on the fallback
    // path, so it carries the same cookbook-specific surface nouns as
    // `COVER_NEGATIVE_PROMPT` — a generic "no text, no letters" was already
    // proven insufficient, and this path runs precisely when Runware is
    // unconfigured or failing, i.e. when there is no second line of defence.
    // (The style negatives — blurry, cartoon, 3d render — stay out; they are a
    // separate concern and DALL-E handles them via the positive prompt.)
    // DALL-E 3 has no 3:4 size — 1024x1792 is its portrait option; the client
    // crops to the cover plate.
    const response = await dalleClient.images.generate(
      {
        model: "dall-e-3",
        prompt: `${prompt} Do not render any of the following: ${COVER_SURFACE_NEGATIVES}.`,
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
