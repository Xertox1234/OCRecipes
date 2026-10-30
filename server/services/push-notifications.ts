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
  type ExpoPushReceipt,
  type ExpoPushTicket,
} from "expo-server-sdk";
import { logger } from "../lib/logger";
import { storage } from "../storage";

let expo: Expo | null = null;
let loggedMissingToken = false;

// Wall-clock timeout for a single push-send chunk. expo-server-sdk exposes no
// per-call timeout, so without this a hung Expo endpoint would stall delivery.
const PUSH_SEND_TIMEOUT_MS = 30_000;

/**
 * Push receipts. An "ok" ticket only means Expo accepted the message; APNs/FCM
 * outcomes — including most DeviceNotRegistered errors — appear only in the
 * receipt, which Expo produces later (docs: check after ~15 minutes; kept for
 * 24h). Tickets are held in memory until checked: a restart forgets the
 * pending ones, which is acceptable for best-effort stale-token pruning (the
 * next send to that token re-tickets it).
 */
export const PUSH_RECEIPT_DELAY_MS = 15 * 60_000;
const PUSH_RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;
const PUSH_RECEIPT_CHECK_INTERVAL_MS = 15 * 60_000;
const MAX_PENDING_RECEIPTS = 10_000;

interface PendingReceipt {
  userId: string;
  token: string;
  sentAt: number;
}
// Insertion-ordered, so the oldest entry is first when trimming.
const pendingReceipts = new Map<string, PendingReceipt>();

function trackReceipt(ticketId: string, entry: PendingReceipt): void {
  pendingReceipts.set(ticketId, entry);
  while (pendingReceipts.size > MAX_PENDING_RECEIPTS) {
    const oldest = pendingReceipts.keys().next().value;
    if (oldest === undefined) break;
    pendingReceipts.delete(oldest);
  }
}

/** Test-only: drop all pending receipt ids. */
export function _resetPushReceiptsForTesting(): void {
  pendingReceipts.clear();
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out`)),
        PUSH_SEND_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

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
  // Each ticket is paired with the token of the message it answers, per
  // chunk (tickets come back in the chunk's message order). Pairing by a
  // global index would shift onto the wrong token once any chunk throws.
  const results: { ticket: ExpoPushTicket; token: string }[] = [];

  for (const chunk of chunks) {
    try {
      const chunkTickets = await withTimeout(
        client.sendPushNotificationsAsync(chunk),
        "push send",
      );
      chunkTickets.forEach((ticket, j) => {
        const to = chunk[j]?.to;
        if (typeof to === "string") results.push({ ticket, token: to });
      });
    } catch (err) {
      logger.error({ err, userId }, "push-notifications: failed to send chunk");
    }
  }

  // Handle delivery errors: remove tokens that have been unregistered by the
  // platform (device token no longer valid). Other errors are logged. Accepted
  // tickets are queued for the receipt check, where most delivery failures
  // actually surface.
  const sentAt = Date.now();
  let accepted = 0;
  for (const { ticket, token } of results) {
    if (ticket.status === "ok") {
      accepted++;
      trackReceipt(ticket.id, { userId, token, sentAt });
      continue;
    }
    if (ticket.details?.error === "DeviceNotRegistered") {
      await storage.deletePushToken(userId, token).catch(() => {});
    } else {
      logger.warn({ ticket, userId }, "push-notifications: delivery error");
    }
  }

  return accepted > 0;
}

/**
 * Fetch receipts for tickets old enough to have one, prune tokens whose
 * receipt reports DeviceNotRegistered, and log other delivery errors.
 * Tickets whose receipt request fails stay queued for the next run; tickets
 * past Expo's 24h receipt retention are dropped.
 */
export async function checkPushReceipts(now = Date.now()): Promise<void> {
  const client = getExpo();
  if (!client || pendingReceipts.size === 0) return;

  const due: string[] = [];
  for (const [id, entry] of pendingReceipts) {
    if (now - entry.sentAt > PUSH_RECEIPT_MAX_AGE_MS) {
      pendingReceipts.delete(id);
    } else if (now - entry.sentAt >= PUSH_RECEIPT_DELAY_MS) {
      due.push(id);
    }
  }
  if (due.length === 0) return;

  for (const chunk of client.chunkPushNotificationReceiptIds(due)) {
    let receipts: Record<string, ExpoPushReceipt>;
    try {
      receipts = await withTimeout(
        client.getPushNotificationReceiptsAsync(chunk),
        "push receipts",
      );
    } catch (err) {
      logger.warn({ err }, "push-notifications: failed to fetch receipts");
      continue;
    }
    for (const id of chunk) {
      const receipt = receipts[id];
      const entry = pendingReceipts.get(id);
      // No receipt yet (Expo still processing) — retry next run.
      if (!receipt || !entry) continue;
      pendingReceipts.delete(id);
      if (receipt.status !== "error") continue;
      if (receipt.details?.error === "DeviceNotRegistered") {
        await storage
          .deletePushToken(entry.userId, entry.token)
          .catch(() => {});
      } else {
        logger.warn(
          { receipt, userId: entry.userId },
          "push-notifications: delivery receipt error",
        );
      }
    }
  }
}

/** Start the periodic receipt check. Returns the handle for shutdown. */
export function startPushReceiptJob(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    checkPushReceipts().catch((err) => {
      logger.error({ err }, "push-notifications: receipt check failed");
    });
  }, PUSH_RECEIPT_CHECK_INTERVAL_MS);
}
