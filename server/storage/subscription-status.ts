import { type User, users } from "@shared/schema";
import {
  isValidSubscriptionTier,
  resolveEffectiveTier,
  subscriptionTierSchema,
  type SubscriptionTier,
} from "@shared/types/premium";
import { db } from "../db";
import { eq } from "drizzle-orm";

// Subscription tier reads/writes on the users row, split out of users.ts
// (pure move). Sibling storage modules import from here, not from users.ts.

export async function getSubscriptionStatus(userId: string): Promise<
  | {
      tier: SubscriptionTier;
      expiresAt: Date | null;
    }
  | undefined
> {
  const [user] = await db
    .select({
      tier: users.subscriptionTier,
      expiresAt: users.subscriptionExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));

  if (!user) return undefined;

  // Validate tier with Zod schema, fallback to "free" if invalid
  const parsedTier = subscriptionTierSchema.safeParse(user.tier);
  return {
    tier: parsedTier.success ? parsedTier.data : "free",
    expiresAt: user.expiresAt,
  };
}

/**
 * Resolve the *effective* subscription tier for a user, accounting for
 * premium expiry. The raw `users.subscriptionTier` is NOT reset on expiry, so
 * indexing `TIER_FEATURES` with it directly grants paid features/limits to
 * lapsed subscribers (revenue leak). This helper is the canonical path: a
 * single `users` select + `resolveEffectiveTier`, with no cache and no
 * additional dependencies. Use it everywhere a feature gate needs the user's
 * current tier — route gates, storage limit checks, inline feature reads.
 *
 * Returns `"free"` for unknown users or invalid stored tiers (fail-closed).
 *
 * EXEMPTION: B2B `ApiTier` (api-key) sites must NOT pass through this helper —
 * they have no expiry concept.
 */
export async function getEffectiveTierForUser(
  userId: string,
): Promise<SubscriptionTier> {
  const [row] = await db
    .select({
      tier: users.subscriptionTier,
      expiresAt: users.subscriptionExpiresAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const storedTier = row?.tier ?? "free";
  const { effectiveTier } = resolveEffectiveTier(
    isValidSubscriptionTier(storedTier) ? storedTier : "free",
    row?.expiresAt ?? null,
  );
  return effectiveTier;
}

export async function updateSubscription(
  userId: string,
  tier: SubscriptionTier,
  expiresAt: Date | null,
): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set({ subscriptionTier: tier, subscriptionExpiresAt: expiresAt })
    .where(eq(users.id, userId))
    .returning();
  return user || undefined;
}
