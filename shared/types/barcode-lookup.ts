import { z } from "zod";

import { verificationLevelSchema } from "./verification";

// ---------------------------------------------------------------------------
// Barcode lookup response validation
// ---------------------------------------------------------------------------
//
// `GET/POST /api/nutrition/barcode/:code` returns JSON the client used to
// consume as `serverRes.json(): any` — an unvalidated 200 was dereferenced
// directly (`data.servingInfo.wasCorrected`) in `client/hooks/
// useNutritionLookup.ts`, so a shape mismatch threw and was swallowed by the
// network-failure catch there, misreporting a server-side bug as "couldn't
// reach our service" with only a dev-only `logger.warn`. That hook now
// validates the shape with `safeParse` against this schema before touching
// it.
//
// Lives in `shared/` (not inline in the hook) so a server test can reference
// the same schema object — `scripts/__tests__/contract-coverage-guard.test.ts`
// requires every client-parsed `<name>Schema` to have a provider-side
// assertion (`test/utils/expect-response-schema.ts`'s `expectResponseToMatch`)
// in a `server/`/`test/` test, the same pattern `@shared/types/recipe-search`'s
// `recipeSearchResponseSchema` already follows. See
// `server/routes/__tests__/nutrition.test.ts` for the assertions.
//
// Deliberately no stricter than what `useNutritionLookup.ts` actually
// dereferences (docs/rules/typescript.md: "an ingestion-boundary Zod schema
// must be no stricter than the code that reads it"). `flags`/`labelCompared`/
// `verificationLevel`/`isBeverage` all already have a defensive runtime
// check downstream in that hook (`Array.isArray`, `typeof`, `=== true`)
// precisely because their shape can't be pinned down further without
// rejecting real traffic — see `useNutritionLookup.test.ts`'s `baseBody()`
// fixture, which ships a flag object with only an `id`
// (`{ id: "processing:ultra" }`), and the `labelCompared: "declined"`
// fixture pinning the `=== true` idiom against a truthy non-boolean. Making
// those fields strict here would fail a currently-working response, which
// is exactly the failure mode this schema exists to remove.
export const barcodePer100gSchema = z.object({
  calories: z.number().optional(),
  protein: z.number().optional(),
  carbs: z.number().optional(),
  fat: z.number().optional(),
  fiber: z.number().optional(),
  sugar: z.number().optional(),
  sodium: z.number().optional(),
  saturatedFat: z.number().optional(),
  transFat: z.number().optional(),
  cholesterol: z.number().optional(),
  caffeine: z.number().optional(),
});

export const barcodeServingInfoSchema = z.object({
  displayLabel: z.string(),
  grams: z.number(),
  wasCorrected: z.boolean(),
  correctionReason: z.string().optional(),
});

// Shape shared by the top-level lookup result and the label-conflict's
// nested `conflict.label` — `server/routes/nutrition.ts`'s
// `buildBarcodeResponseBody` builds both the same way.
export const barcodeNutritionResultSchema = z.object({
  productName: z.string(),
  brandName: z.string().optional(),
  imageUrl: z.string().optional(),
  per100g: barcodePer100gSchema,
  perServing: barcodePer100gSchema,
  servingInfo: barcodeServingInfoSchema,
  isServingDataTrusted: z.boolean(),
  flags: z.array(z.unknown()).optional(),
});

export const barcodeLookupResponseSchema = barcodeNutritionResultSchema.extend({
  labelCompared: z.unknown().optional(),
  // `.catch(undefined)` — a verification-level value the client doesn't
  // recognise yet (a future server adding a new tier) must not fail the
  // WHOLE parse and mask real nutrition data behind a false "malformed"
  // report; the verification badge is cosmetic, not load-bearing.
  verificationLevel: verificationLevelSchema.optional().catch(undefined),
  isBeverage: z.unknown().optional(),
  conflict: z
    .object({
      fields: z.array(z.string()).optional(),
      label: barcodeNutritionResultSchema,
    })
    .optional(),
});

export type BarcodeLookupResponse = z.infer<typeof barcodeLookupResponseSchema>;
