import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  allergenWord,
  allergyEditsSchema,
  type AllergyCardEdits,
  type AllergyCardPayload,
} from "@shared/schemas/coach-write-cards";
import type { AllergenId } from "@shared/constants/allergens";
import { storage } from "../../storage";
import {
  getProfileAllergies,
  setProfileAllergies,
} from "../../storage/user-profiles";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import type { AfterCommit } from "../../storage/meal-plan-recipes-crud";
import { fireAndForget } from "../../lib/fire-and-forget";
import { WriteCardEditError } from "./errors";
import { savableCardPayload } from "./payload";

/** The dietary profile holds at most this many (server/routes/_schemas.ts). */
const MAX_ALLERGIES = 30;

const listed = (allergies: { name: string }[], allergen: string) =>
  allergies.some((a) => a.name.trim().toLowerCase() === allergen);

/**
 * A card to add one allergen. Throws, so the turn shows no card, when the
 * allergen is already on file or the user has not agreed to store health
 * data: that agreement is given on the profile screen, never on a card.
 */
export async function buildAllergyPayload(
  args: { allergen: AllergenId },
  userId: string,
): Promise<AllergyCardPayload> {
  const profile = await getProfileAllergies(userId);
  if (!profile?.hasHealthConsent) {
    throw new WriteCardEditError("No health-data consent on record.");
  }
  if (listed(profile.allergies, args.allergen)) {
    throw new WriteCardEditError("This allergy is already on file.");
  }
  return { allergen: args.allergen };
}

/** What the dietary-profile route refreshes after an allergy change. */
const refreshSuggestions = (userId: string) => () =>
  fireAndForget(
    "suggestion-cache-invalidation",
    storage.invalidateSuggestionCacheForUser(userId),
  );

export async function performAllergySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string; afterCommit?: AfterCommit },
): Promise<CoachWriteCardSavedRefs> {
  const parsed = allergyEditsSchema.safeParse(rawEdits ?? {});
  // The severity is the user's own choice: there is no default to save with.
  if (!parsed.success || !parsed.data.severity) {
    throw new WriteCardEditError("Choose how severe the allergy is.");
  }
  const { severity } = parsed.data;
  const { allergen } = savableCardPayload(card, "allergy");
  // The profile as it is now, not as it was when the card was built.
  const profile = await getProfileAllergies(ctx.userId, tx, {
    forUpdate: true,
  });
  if (!profile?.hasHealthConsent) {
    throw new WriteCardEditError(
      "Agree to store health details in your dietary profile first.",
    );
  }
  if (listed(profile.allergies, allergen)) {
    throw new WriteCardEditError("This allergy is already in your profile.");
  }
  if (profile.allergies.length >= MAX_ALLERGIES) {
    throw new WriteCardEditError(
      "Your profile has no room for more allergies.",
    );
  }
  const added = { name: allergen, severity };
  await setProfileAllergies(ctx.userId, [...profile.allergies, added], tx);
  ctx.afterCommit?.(refreshSuggestions(ctx.userId));
  return { allergyAdded: added };
}

/** Removes the allergy this card added, while it still has that severity. */
export async function revertAllergySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  afterCommit?: AfterCommit,
): Promise<void> {
  const added = card.savedRefs?.allergyAdded;
  if (!added) return;
  const profile = await getProfileAllergies(card.userId, tx, {
    forUpdate: true,
  });
  if (!profile) return;
  const kept = profile.allergies.filter(
    (a) => !(a.name === added.name && a.severity === added.severity),
  );
  if (kept.length === profile.allergies.length) return;
  await setProfileAllergies(card.userId, kept, tx);
  afterCommit?.(refreshSuggestions(card.userId));
}

/** The live card for the prompt. */
export function describeAllergy(
  p: AllergyCardPayload,
  e: AllergyCardEdits,
): string {
  return `add ${allergenWord(p.allergen)} to the user's allergies; severity ${e.severity ?? "not chosen yet"}`;
}
