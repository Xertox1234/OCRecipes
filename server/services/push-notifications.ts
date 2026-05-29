/**
 * Push notification delivery via Expo Push Notification Service.
 *
 * Expo's push service is a unified layer over APNs (iOS) and FCM (Android),
 * so we do not need to manage platform credentials separately.
 *
 * Requires EXPO_ACCESS_TOKEN in the environment for production use.
 * When the token is absent the service logs a warning and skips delivery —
 * the in-app local-notification fallback (useNotebookNotifications) still fires
 * on the client side.
 *
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */
// eslint-disable-next-line import/no-named-as-default
import Expo, {
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { logger } from "../lib/logger";
import { storage } from "../storage";

let expo: Expo | null = null;
let loggedMissingToken = false;

// Wall-clock timeout for a single push-send chunk. expo-server-sdk exposes no
// per-call timeout, so without this a hung Expo endpoint would stall delivery.
const PUSH_SEND_TIMEOUT_MS = 30_000;

function getExpo(): Expo | null {
  if (expo) return expo;
  const token = process.env.EXPO_ACCESS_TOKEN;
  if (!token) {
    if (!loggedMissingToken) {
      loggedMissingToken = true;
      logger.warn(
        "push-notifications: EXPO_ACCESS_TOKEN not set — push delivery disabled",
      );
    }
    return null;
  }
  expo = new Expo({ accessToken: token });
  return expo;
}

/**
 * Send a push notification to all devices registered for a user.
 *
 * @param userId   - target user
 * @param title    - notification title
 * @param body     - notification body text (max ~255 chars visible on lock screen)
 * @param data     - arbitrary payload delivered to the app (e.g. { entryId })
 * @returns true if at least one message was accepted by Expo, false otherwise
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<boolean> {
  const client = getExpo();
  if (!client) return false;

  const tokens = await storage.getPushTokensForUser(userId);
  if (tokens.length === 0) return false;

  // Keep only valid Expo push tokens; track them in a separate array so ticket
  // indices align with validTokens indices below.
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t.token));
  const messages: ExpoPushMessage[] = validTokens.map((t) => ({
    to: t.token,
    title,
    body,
    data,
    sound: "default" as const,
  }));

  if (messages.length === 0) return false;

  const chunks = client.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const chunkTickets = await Promise.race([
        client.sendPushNotificationsAsync(chunk),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("push send timed out")),
            PUSH_SEND_TIMEOUT_MS,
          );
        }),
      ]);
      tickets.push(...chunkTickets);
    } catch (err) {
      logger.error({ err, userId }, "push-notifications: failed to send chunk");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // Handle delivery errors: remove tokens that have been unregistered by the
  // platform (device token no longer valid). Other errors are logged.
  // tickets[i] corresponds to validTokens[i] — indices align because messages
  // was built from validTokens in the same order.
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket.status !== "error") continue;
    if (ticket.details?.error === "DeviceNotRegistered") {
      const staleToken = validTokens[i];
      if (staleToken) {
        await storage.deletePushToken(userId, staleToken.token).catch(() => {});
      }
    } else {
      logger.warn({ ticket, userId }, "push-notifications: delivery error");
    }
  }

  const accepted = tickets.filter((t) => t.status === "ok");
  return accepted.length > 0;
}
