/**
 * The single front door for sending a user-facing notification. Producers call
 * notify() instead of sendPushToUser / createPendingReminder directly. Routes by
 * the category registry to the right channel(s) and records discretionary sends
 * in the notification_sends ledger. Phase 0: no cap/quiet-hours enforcement — pure
 * routing that preserves today's behavior.
 */
import { storage } from "../../storage";
import { sendPushToUser } from "../push-notifications";
import { getCategoryDef, type NotificationCategoryKey } from "./registry";

export interface NotifyPayload {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  context?: Record<string, unknown>;
  scheduledFor?: Date;
}

export interface NotifyResult {
  pushDelivered: boolean;
}

export async function notify(
  userId: string,
  category: NotificationCategoryKey,
  payload: NotifyPayload = {},
): Promise<NotifyResult> {
  const def = getCategoryDef(category);
  const scheduledFor = payload.scheduledFor ?? new Date();
  let pushDelivered = false;

  if (def.channels.includes("in-app")) {
    await storage.createPendingReminder({
      userId,
      type: category,
      context: payload.context ?? {},
      scheduledFor,
    });
  }

  if (def.channels.includes("push")) {
    pushDelivered = await sendPushToUser(
      userId,
      payload.title ?? "",
      payload.body ?? "",
      payload.data,
    );
  }

  if (def.countsAgainstCap) {
    await storage.recordNotificationSend({
      userId,
      category,
      sentAt: scheduledFor,
    });
  }

  return { pushDelivered };
}
