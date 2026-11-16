import { z } from "zod";
import { allergySchema } from "../schema";
import type { PremiumFeatures } from "./premium";

/** Who a planned meal is for. `profile` means one family profile; see `mealAudienceInputSchema`. */
export const MEAL_AUDIENCES = ["self", "shared", "profile"] as const;
export type MealAudience = (typeof MEAL_AUDIENCES)[number];

export const MAX_FAMILY_PROFILES = 8;
export const FAMILY_NAME_MAX = 50;
export const FAMILY_NOTE_MAX = 200;
export const FAMILY_ALLERGIES_MAX = 30;

/** Body of a family-profile create or update. The name is trimmed; a blank or omitted note becomes null. */
export const familyProfileInputSchema = z.object({
  name: z.string().trim().min(1).max(FAMILY_NAME_MAX),
  allergies: z.array(allergySchema).max(FAMILY_ALLERGIES_MAX),
  note: z.preprocess((value) => {
    // The note is optional: a body that leaves it out means "no note".
    if (value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }, z.string().max(FAMILY_NOTE_MAX).nullable()),
});

export type FamilyProfileInput = z.output<typeof familyProfileInputSchema>;

/** A meal's audience: a `profile` audience needs a profile id; the others must not carry one. */
export const mealAudienceInputSchema = z
  .object({
    audience: z.enum(MEAL_AUDIENCES),
    familyProfileId: z.number().int().positive().nullable(),
  })
  .refine(
    (value) =>
      (value.audience === "profile") === (value.familyProfileId !== null),
    {
      message:
        "familyProfileId is required for a profile audience and not allowed otherwise",
      path: ["familyProfileId"],
    },
  );

/** Family planning is live only with the premium flag AND the user's own switch on. */
export function isFamilyPlanningActive(
  features: Pick<PremiumFeatures, "familyProfiles">,
  profile: { familyPlanningEnabled: boolean } | null | undefined,
): boolean {
  return features.familyProfiles && profile?.familyPlanningEnabled === true;
}
