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
import { logger, toError } from "../lib/logger";
import { storage } from "../storage";

let expo: Expo | null = null;
let loggedMissingToken = false;

// Wall-clock timeout for a single push-send chunk. expo-server-sdk exposes no
// per-call timeout, so without this a hung Expo endpoint would stall delivery.
const PUSH_SEND_TIMEOUT_MS = 30_000;

// Expo recommends waiting ~15 minutes before fetching push receipts.
const RECEIPT_CHECK_DELAY_MS = 15 * 60_000;

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

async function deleteStaleToken(userId: string, token: string): Promise<void> {
  // Best-effort, but never silent: a systematic failure here leaves dead
  // tokens that are retried on every send.
  await storage.deletePushToken(userId, token).catch((err: unknown) => {
    logger.warn(
      { err: toError(err), userId },
      "push-notifications: stale token delete failed",
    );
  });
}

/**
 * Pair one chunk's tickets with that chunk's own messages (Expo returns one
 * ticket per message, in order). Prunes tokens the platform reports as
 * unregistered, logs other errors, and records receipt ids of accepted tickets.
 */
async function handleChunkTickets(
  userId: string,
  chunk: ExpoPushMessage[],
  chunkTickets: ExpoPushTicket[],
  receiptTokens: Map<string, string>,
): Promise<void> {
  if (chunkTickets.length !== chunk.length) {
    logger.warn(
      { userId, sent: chunk.length, tickets: chunkTickets.length },
      "push-notifications: ticket count mismatch — skipping pairing for chunk",
    );
    return;
  }
  for (let j = 0; j < chunkTickets.length; j++) {
    const ticket = chunkTickets[j];
    const to = chunk[j].to;
    const token = typeof to === "string" ? to : undefined;
    if (ticket.status === "ok") {
      if (token) receiptTokens.set(ticket.id, token);
      continue;
    }
    if (ticket.details?.error === "DeviceNotRegistered") {
      if (token) await deleteStaleToken(userId, token);
    } else {
      logger.warn({ ticket, userId }, "push-notifications: delivery error");
    }
  }
}

async function checkReceipts(
  client: Expo,
  userId: string,
  receiptTokens: Map<string, string>,
): Promise<void> {
  try {
    for (const ids of client.chunkPushNotificationReceiptIds([
      ...receiptTokens.keys(),
    ])) {
      let receipts;
      try {
        receipts = await client.getPushNotificationReceiptsAsync(ids);
      } catch (err) {
        logger.warn(
          { err: toError(err), userId },
          "push-notifications: receipt fetch failed",
        );
        continue;
      }
      for (const [id, receipt] of Object.entries(receipts)) {
        if (receipt.status !== "error") continue;
        const token = receiptTokens.get(id);
        if (receipt.details?.error === "DeviceNotRegistered") {
          if (token) await deleteStaleToken(userId, token);
        } else {
          logger.warn({ receipt, userId }, "push-notifications: receipt error");
        }
      }
    }
  } catch (err) {
    logger.warn(
      { err: toError(err), userId },
      "push-notifications: receipt check failed",
    );
  }
}

/**
 * Expo recommends checking receipts ~15 min after sending. Fire-and-forget:
 * never blocks the send path, and the timer is unref'd so it cannot hold the
 * process open. Pending receipts live only in memory — losing them on a server
 * restart is acceptable (the dead token is simply pruned on a later send).
 */
function scheduleReceiptCheck(
  client: Expo,
  userId: string,
  receiptTokens: Map<string, string>,
): void {
  const timer = setTimeout(() => {
    void checkReceipts(client, userId, receiptTokens);
  }, RECEIPT_CHECK_DELAY_MS) as unknown as NodeJS.Timeout;
  timer.unref();
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

  // Keep only valid Expo push tokens.
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
  // receiptId -> token, filled per chunk so a failed chunk can never shift
  // later tickets onto the wrong token.
  const receiptTokens = new Map<string, string>();
  let accepted = 0;

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
      accepted += chunkTickets.filter((t) => t.status === "ok").length;
      await handleChunkTickets(userId, chunk, chunkTickets, receiptTokens);
    } catch (err) {
      logger.error({ err, userId }, "push-notifications: failed to send chunk");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (receiptTokens.size > 0) {
    scheduleReceiptCheck(client, userId, receiptTokens);
  }

  return accepted > 0;
}
