/**
 * Proactive Coach, first trigger: pantry items about to expire. The Coach
 * opens a conversation with one fixed-wording message and pushes a link to
 * it. At most one a day per user, and none on a day the Coach already pushed
 * a commitment follow-up.
 *
 * The scheduler calls this once a day per user at a fixed local hour, so the
 * 24-hour window below lines up end to end with yesterday's and tomorrow's:
 * each item is named once, on the day before it expires.
 */
import { storage } from "../../storage";
import { TIER_FEATURES } from "@shared/types/premium";
import { renderPantryExpiryNudge } from "@shared/lib/pantry-expiry-nudge";
import { civilDateString, civilDateToInstant } from "../../lib/civil-date";
import { logger, toError } from "../../lib/logger";
import { notify } from "../notifications/notify";

const CATEGORY = "pantry-expiring";
const WINDOW_MS = 24 * 60 * 60 * 1000;

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
  const tier = await storage.getEffectiveTierForUser(userId);
  if (!TIER_FEATURES[tier].pantryTracking) return "skipped-no-pantry";

  const items = await storage.getPantryItemsExpiringBetween(
    userId,
    now,
    new Date(now.getTime() + WINDOW_MS),
  );
  const nudge = renderPantryExpiryNudge(items.map((i) => i.name));
  if (!nudge) return "skipped-nothing-expiring";

  const startOfLocalDay = civilDateToInstant(civilDateString(now, tz), tz);
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

  // A conversation nobody was told about would just appear in the list, so it
  // goes when the push reaches no device.
  const removeConversation = async () => {
    try {
      await storage.deleteChatConversation(conversation.id, userId);
    } catch (err) {
      logger.error(
        { err: toError(err), userId, conversationId: conversation.id },
        "proactive coach: could not remove an unannounced conversation",
      );
    }
  };

  let pushDelivered: boolean;
  try {
    ({ pushDelivered } = await notify(userId, CATEGORY, {
      title: nudge.title,
      body: nudge.body,
      data: {
        url: `ocrecipes://chat/${conversation.id}`,
        type: CATEGORY,
        conversationId: conversation.id,
      },
      scheduledFor: now,
    }));
  } catch (err) {
    await removeConversation();
    throw err;
  }
  if (!pushDelivered) {
    await removeConversation();
    return "not-delivered";
  }
  return "sent";
}
