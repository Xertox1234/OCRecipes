import type { CoachWriteCard, CoachWriteCardSavedRefs } from "@shared/schema";
import {
  allergenWord,
  familyEditsSchema,
  type FamilyCardEdits,
  type FamilyCardPayload,
} from "@shared/schemas/coach-write-cards";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";
import {
  createFamilyProfileIn,
  deleteFamilyProfileIfUnchanged,
  getFamilyProfiles,
} from "../../storage/family-profiles";
import { getProfileAllergies } from "../../storage/user-profiles";
import { getEffectiveTierForUser } from "../../storage/subscription-status";
import { TIER_FEATURES } from "@shared/types/premium";
import type { WriteCardTx } from "../../storage/coach-write-cards";
import { WriteCardEditError } from "./errors";
import { savableCardPayload } from "./payload";
import type { AddFamilyMemberCardArgs, FamilyCardRefusal } from "./tool-args";

export {
  addFamilyMemberCardArgsSchema,
  type AddFamilyMemberCardArgs,
} from "./tool-args";

/**
 * The family card (Coach roadmap A3; owner ruling 2026-11-27): adds one
 * family member the user named in the chat, with the rules the Family
 * screen keeps (at most eight people, allergies only with the health-data
 * agreement). Stored profiles are read here to check those rules and never
 * leave the server: the model hears only why a card was not made (the
 * family is full, or the allergies need consent). Whether a name is already
 * taken is checked at save, so the model never learns which names exist.
 */

/** No card, and why (the tool tells the model the reason, nothing more). */
export class FamilyCardRefused extends WriteCardEditError {
  constructor(readonly reason: FamilyCardRefusal) {
    super(`No family card: ${reason}.`);
    this.name = "FamilyCardRefused";
  }
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

export async function buildFamilyPayload(
  args: AddFamilyMemberCardArgs,
  userId: string,
): Promise<FamilyCardPayload> {
  const allergens = [...new Set(args.allergens)];
  const profiles = await getFamilyProfiles(userId);
  if (profiles.length >= MAX_FAMILY_PROFILES) {
    throw new FamilyCardRefused("limit");
  }
  if (
    allergens.length > 0 &&
    !(await getProfileAllergies(userId))?.hasHealthConsent
  ) {
    throw new FamilyCardRefused("consent");
  }
  return { name: args.name.trim(), allergens };
}

/** Strict parse, with a picked severity for every allergen on the card. */
function parseFamilyEdits(
  p: FamilyCardPayload,
  raw: unknown,
): ("mild" | "moderate" | "severe")[] {
  const parsed = familyEditsSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new WriteCardEditError("These changes can't be saved.");
  }
  const severities = parsed.data.severities ?? [];
  if (
    severities.length !== p.allergens.length ||
    severities.some((s) => s === null)
  ) {
    throw new WriteCardEditError("Choose how severe each allergy is.");
  }
  return severities as ("mild" | "moderate" | "severe")[];
}

export async function performFamilySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
  rawEdits: unknown,
  ctx: { userId: string },
): Promise<CoachWriteCardSavedRefs> {
  const payload = savableCardPayload(card, "family");
  const severities = parseFamilyEdits(payload, rawEdits);
  // The plan as it is now, as the Family screen checks it: a card can
  // outlive the subscription. Undo is not gated.
  const tier = await getEffectiveTierForUser(ctx.userId, tx);
  if (!TIER_FEATURES[tier].familyProfiles) {
    throw new WriteCardEditError(
      "Your plan no longer includes family profiles.",
    );
  }
  if (payload.allergens.length > 0) {
    // The agreement as it is now: it can be withdrawn after the card is made.
    const profile = await getProfileAllergies(ctx.userId, tx, {
      forUpdate: true,
    });
    if (!profile?.hasHealthConsent) {
      throw new WriteCardEditError(
        "Agree to store health details in your dietary profile first.",
      );
    }
  }
  // A nested transaction only to reach the full transaction client the
  // family storage needs (its advisory lock is held until the card's own
  // transaction commits), as the pantry card does.
  const allergies = payload.allergens.map((name, i) => ({
    name,
    severity: severities[i],
  }));
  const created = await tx.transaction(async (inner) => {
    const made = await createFamilyProfileIn(inner, ctx.userId, {
      name: payload.name,
      allergies,
      note: null,
    });
    if (made === "limit") return made;
    // Under the family lock the create took: a name added meanwhile (on the
    // Family screen, or by another card) is seen. The user hears it on the
    // card; the model is never told which names exist.
    const others = (await getFamilyProfiles(ctx.userId, inner)).filter(
      (p) => p.id !== made.id,
    );
    if (others.some((p) => sameName(p.name, payload.name))) {
      throw new WriteCardEditError(
        `${payload.name} is already in your family.`,
      );
    }
    return made;
  });
  if (created === "limit") {
    throw new WriteCardEditError(
      `You can add up to ${MAX_FAMILY_PROFILES} people.`,
    );
  }
  return {
    familyAdded: { id: created.id, name: created.name, allergies },
  };
}

/**
 * Removes the person this card added, only while they are exactly as saved
 * and have no planned meals (deleting a profile takes its meals with it).
 * Someone the user has changed or planned for since is kept.
 */
export async function revertFamilySave(
  tx: WriteCardTx,
  card: CoachWriteCard,
): Promise<void> {
  const added = card.savedRefs?.familyAdded;
  if (!added) return;
  await deleteFamilyProfileIfUnchanged(tx, card.userId, added);
}

/**
 * The live card for the prompt: the name and allergens the Coach proposed.
 * Never the severities, which only the user chooses.
 */
export function describeFamily(
  p: FamilyCardPayload,
  _e: FamilyCardEdits,
): string {
  return p.allergens.length === 0
    ? `${p.name}, no allergies`
    : `${p.name}, allergies: ${p.allergens.map(allergenWord).join(", ")}`;
}
