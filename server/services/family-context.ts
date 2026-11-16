import type { FamilyProfile } from "@shared/schema";
import { isFamilyPlanningActive } from "@shared/types/family";
import type { PremiumFeatures } from "@shared/types/premium";
import { storage } from "../storage";

export interface FamilyContext {
  active: boolean;
  profiles: FamilyProfile[];
}

/**
 * Whether family planning is live for this user (premium flag AND their own
 * switch) and, only when it is, their profiles. Inactive never loads profiles.
 */
export async function getFamilyContext(
  userId: string,
  features: PremiumFeatures,
): Promise<FamilyContext> {
  const userProfile = await storage.getUserProfile(userId);
  if (!isFamilyPlanningActive(features, userProfile)) {
    return { active: false, profiles: [] };
  }
  return { active: true, profiles: await storage.getFamilyProfiles(userId) };
}
