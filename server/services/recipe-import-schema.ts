/**
 * Zod schema for schema.org Recipe LD+JSON, with lenient coercion of the
 * optional fields. Pure and fetch-free; consumed by `recipe-import.ts`.
 */
import { z } from "zod";

// ── Zod Schema for schema.org Recipe LD+JSON ─────────────────────────

const howToStepSchema = z.object({
  "@type": z.literal("HowToStep").optional(),
  text: z.string(),
});

// ── Lenient coercion for optional LD+JSON fields ─────────────────────
//
// Real-world schema.org markup is loose: `image` may be an ImageObject,
// `recipeYield` a number or QuantitativeValue, `recipeInstructions` may
// nest HowToSection groups, nutrition values may be numbers. Every optional
// field is coerced to the shape we consume and, if still unusable, dropped
// via `.catch(undefined)` — one off-spec field must never fail the whole
// import (only a missing/invalid `name` does).

const isHttpUrl = (u: string) => /^https?:\/\//i.test(u);

const httpUrlSchema = z.string().url().refine(isHttpUrl, {
  message: "image URL must use http or https",
});

/** Unwrap an ImageObject (`{url}` / `{contentUrl}`) to its URL string. */
function imageToUrl(val: unknown): unknown {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.contentUrl === "string") return o.contentUrl;
  }
  return val;
}

function coerceImage(val: unknown): unknown {
  if (Array.isArray(val)) {
    // Keep only usable http(s) URLs so one bad entry doesn't drop the rest.
    return val
      .map(imageToUrl)
      .filter(
        (u): u is string =>
          typeof u === "string" && httpUrlSchema.safeParse(u).success,
      );
  }
  return imageToUrl(val);
}

/** Number → string; QuantitativeValue `{value}` → string. */
function coerceScalarText(val: unknown): unknown {
  if (typeof val === "number" && Number.isFinite(val)) return String(val);
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const o = val as Record<string, unknown>;
    if (typeof o.value === "number" || typeof o.value === "string") {
      return String(o.value);
    }
  }
  return val;
}

function coerceTextOrList(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val
      .map(coerceScalarText)
      .filter((v): v is string => typeof v === "string");
  }
  return coerceScalarText(val);
}

/**
 * Flatten HowToSection groups (`itemListElement`) and single step objects
 * into a flat list of step strings. A bare string is left as-is.
 */
function flattenInstructions(val: unknown): unknown {
  if (typeof val === "string" || val == null) return val;
  const out: string[] = [];
  const visit = (item: unknown, depth: number) => {
    if (depth > 5) return;
    if (typeof item === "string") {
      out.push(item);
    } else if (Array.isArray(item)) {
      item.forEach((i) => visit(i, depth + 1));
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (o.itemListElement !== undefined) {
        visit(o.itemListElement, depth + 1);
      } else if (typeof o.text === "string") {
        out.push(o.text);
      } else if (typeof o.name === "string") {
        out.push(o.name);
      }
    }
  };
  visit(val, 0);
  return out;
}

function lenient<T extends z.ZodTypeAny>(
  schema: T,
  coerce: (val: unknown) => unknown = (v) => v,
) {
  return z.preprocess(coerce, schema.optional()).catch(undefined);
}

const optionalText = () => lenient(z.string(), coerceScalarText);
const optionalTextOrList = () =>
  lenient(z.union([z.string(), z.array(z.string())]), coerceTextOrList);

export const schemaOrgRecipeSchema = z.object({
  "@type": z.union([z.literal("Recipe"), z.array(z.string())]),
  name: z.string(),
  description: lenient(z.string()),
  image: lenient(z.union([httpUrlSchema, z.array(httpUrlSchema)]), coerceImage),
  recipeIngredient: lenient(z.array(z.string()), (v) =>
    Array.isArray(v) ? v.filter((i) => typeof i === "string") : v,
  ),
  recipeInstructions: lenient(
    z.union([z.string(), z.array(z.union([z.string(), howToStepSchema]))]),
    flattenInstructions,
  ),
  prepTime: lenient(z.string()),
  cookTime: lenient(z.string()),
  totalTime: lenient(z.string()),
  recipeYield: optionalTextOrList(),
  recipeCuisine: optionalTextOrList(),
  recipeCategory: optionalTextOrList(),
  keywords: optionalTextOrList(),
  nutrition: lenient(
    z.object({
      calories: optionalText(),
      proteinContent: optionalText(),
      carbohydrateContent: optionalText(),
      fatContent: optionalText(),
      fiberContent: optionalText(),
      sugarContent: optionalText(),
      sodiumContent: optionalText(),
    }),
  ),
});

export type SchemaOrgRecipe = z.infer<typeof schemaOrgRecipeSchema>;
