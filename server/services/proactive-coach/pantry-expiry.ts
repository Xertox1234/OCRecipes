/**
 * Proactive Coach, first trigger: pantry items about to expire. The Coach
 * opens a conversation with one fixed-wording message and pushes a link to
 * it. At most one a day per user, and none on a day the Coach already pushed
 * a commitment follow-up.
 *
 * The scheduler calls this once a day per user, at PANTRY_EXPIRY_LOCAL_HOUR.
 * The window runs from that hour on the user's calendar day to the same hour
 * on the next, measured from local midnight, so one day's window ends exactly
 * where the next begins whenever the tick lands and whatever the clocks do:
 * each item is named once, on the day before it expires.
 *
 * What it does not do: catch up. A day that is skipped (a missed tick, a
 * commitment push, a push that reached no device) is not made up, and its
 * items are never named. The day's slot is one per UTC day
 * (notification_sends), so a user who changes timezone can lose a day.
 */
import { storage } from "../../storage";
import { TIER_FEATURES } from "@shared/types/premium";
import { renderPantryExpiryNudge } from "@shared/lib/pantry-expiry-nudge";
import {
  addCivilDays,
  civilDateString,
  civilDateToInstant,
} from "../../lib/civil-date";
import { logger, toError } from "../../lib/logger";
import { notify } from "../notifications/notify";

const CATEGORY = "pantry-expiring";
/** Mid-afternoon: early enough to plan tonight's dinner around what expires. */
export const PANTRY_EXPIRY_LOCAL_HOUR = 16;
const HOUR_MS = 60 * 60 * 1000;

export type PantryNudgeResult =
  | "sent"
  | "not-delivered"
  | "skipped-no-pantry"
  | "skipped-nothing-expiring"
  | "skipped-already-pushed-today"
  | "skipped-daily-cap";

export async function nudgeAboutExpiringPantry(
  userId: string,
  now: Date,
  tz: string,
): Promise<PantryNudgeResult> {
  const today = civilDateString(now, tz);
  const startOfLocalDay = civilDateToInstant(today, tz);
  const windowAt = (day: string) =>
    new Date(
      civilDateToInstant(day, tz).getTime() +
        PANTRY_EXPIRY_LOCAL_HOUR * HOUR_MS,
    );

  // Pantry first: most users have nothing expiring, and need no plan lookup.
  const items = await storage.getPantryItemsExpiringBetween(
    userId,
    windowAt(today),
    windowAt(addCivilDays(today, 1)),
  );
  const nudge = renderPantryExpiryNudge(items.map((i) => i.name));
  if (!nudge) return "skipped-nothing-expiring";

  const tier = await storage.getEffectiveTierForUser(userId);
  if (!TIER_FEATURES[tier].pantryTracking) return "skipped-no-pantry";

  if (await storage.hasReminderSince(userId, "commitment", startOfLocalDay)) {
    return "skipped-already-pushed-today";
  }

  // The slot is claimed before anything is written or sent, and is kept
  // whatever happens next: a failed push is not retried into a second one.
  const claimed = await storage.claimNotificationSend({
    userId,
    category: CATEGORY,
    sentAt: now,
  });
  if (!claimed) return "skipped-daily-cap";

  const conversation = await storage.createConversationWithAssistantMessage(
    userId,
    "Expiring soon",
    nudge.message,
    { kind: "proactive", trigger: CATEGORY },
  );

  // If this throws, the push may already be on the phone (the send comes
  // before notify's own bookkeeping), so the conversation it links to stays.
  const { pushDelivered } = await notify(userId, CATEGORY, {
    title: nudge.title,
    body: nudge.body,
    data: {
      url: `ocrecipes://chat/${conversation.id}`,
      type: CATEGORY,
      conversationId: conversation.id,
    },
    scheduledFor: now,
  });
  if (pushDelivered) return "sent";

  // A conversation nobody was told about would just appear in the list, so it
  // goes when the push reached no device. The day's items are not retried.
  logger.warn(
    { userId, items: items.length },
    "proactive coach: pantry nudge reached no device",
  );
  try {
    await storage.deleteChatConversation(conversation.id, userId);
  } catch (err) {
    logger.error(
      { err: toError(err), userId, conversationId: conversation.id },
      "proactive coach: could not remove an unannounced conversation",
    );
  }
  return "not-delivered";
}
