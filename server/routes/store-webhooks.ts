import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  handleAppleNotification,
  handleGoogleNotification,
  verifyGooglePushToken,
} from "../services/store-notifications";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError } from "./_helpers";
import { webhookRateLimit } from "./_rate-limiters";

const appleNotificationBodySchema = z.object({
  signedPayload: z.string().min(1),
});

/**
 * Store server-notification webhooks — UNAUTHENTICATED. The stores (not a
 * logged-in user) call these; authenticity is established by the payload
 * signature (Apple JWS), NOT by app auth, so there is no `requireAuth`. This
 * module must be registered BEFORE the auth-bearing route modules.
 */
export function register(app: Express): void {
  // Apple App Store Server Notifications V2. The JWS signature (verified inside
  // handleAppleNotification, chaining to an Apple Root CA) IS the authentication.
  app.post(
    "/webhooks/apple/notifications",
    webhookRateLimit,
    async (req: Request, res: Response) => {
      try {
        const parsed = appleNotificationBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return sendError(
            res,
            400,
            "Missing signedPayload",
            ErrorCode.VALIDATION_ERROR,
          );
        }
        await handleAppleNotification(parsed.data.signedPayload);
        // 200 acknowledges receipt (Apple retries on 4xx/5xx). A forged or
        // unverifiable signature throws → handled below as 5xx; Apple never
        // sends those, so the retry is moot for forgeries.
        res.json({ received: true });
      } catch (error) {
        handleRouteError(res, error, "apple store notification");
      }
    },
  );

  // Google Play Real-time Developer Notifications via a Pub/Sub PUSH. The OIDC
  // bearer token (verified below) IS the authentication; a missing/invalid
  // token is rejected 401 (a forged push is not retried).
  app.post(
    "/webhooks/google/rtdn",
    webhookRateLimit,
    async (req: Request, res: Response) => {
      try {
        const authed = await verifyGooglePushToken(req.headers.authorization);
        if (!authed) {
          return sendError(
            res,
            401,
            "Invalid Pub/Sub token",
            ErrorCode.UNAUTHORIZED,
          );
        }
        await handleGoogleNotification(req.body);
        res.json({ received: true });
      } catch (error) {
        handleRouteError(res, error, "google rtdn");
      }
    },
  );
}
