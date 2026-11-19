import { isFamilyPlanningActive } from "@shared/types/family";
import type { PremiumFeatures } from "@shared/types/premium";
import { storage } from "../storage";

export interface FamilyContext {
  active: boolean;
  profileCount: number;
}

/**
 * Whether family planning is live for this user (premium flag AND their own
 * switch) and, only when it is, how many profiles they have.
 *
 * A count, never the profiles: some callers build AI prompts, and a profile's
 * name, allergies and note are other people's health data that no provider
 * may receive (family profiles spec; owner ruling 2026-11-18). A caller that
 * holds no rows cannot interpolate them by accident.
 */
export async function getFamilyContext(
  userId: string,
  features: PremiumFeatures,
): Promise<FamilyContext> {
  const userProfile = await storage.getUserProfile(userId);
  if (!isFamilyPlanningActive(features, userProfile)) {
    return { active: false, profileCount: 0 };
  }
  return {
    active: true,
    profileCount: await storage.countFamilyProfiles(userId),
  };
}
