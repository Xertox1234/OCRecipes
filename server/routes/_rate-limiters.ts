/**
 * Rate limiter factory and pre-configured rate limiter instances.
 */
import type { Request } from "express";
import {
  rateLimit,
  ipKeyGenerator as normalizeIpKey,
} from "express-rate-limit";

/**
 * Extract the client IP for rate limiting (auth routes and fallback when no
 * userId). On Railway (detected via the injected RAILWAY_ENVIRONMENT_NAME),
 * prefers the edge proxy's X-Real-IP — Railway overwrites it on every
 * request, so it is not client-spoofable there, and it is immune to
 * proxy-hop-count drift that would break the req.ip/X-Forwarded-For path.
 * Anywhere else the header is client-suppliable (choose-your-own-bucket
 * evasion), so trust fails closed to req.ip (trust proxy = 1) → socket
 * address. If Cloudflare proxying is ever enabled in front of the API,
 * switch to CF-Connecting-IP and re-evaluate the hop count.
 */
export function ipKeyGenerator(req: Request): string {
  if (process.env.RAILWAY_ENVIRONMENT_NAME) {
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp) return normalizeIpKey(realIp);
  }
  const ip = req.ip || req.socket.remoteAddress;
  // normalizeIpKey buckets IPv6 to its /56 subnet (IPv4 passes through) so
  // a user can't dodge the limiter by cycling addresses within their block.
  return ip ? normalizeIpKey(ip) : "unknown";
}

/**
 * Factory for creating express-rate-limit middleware with consistent defaults.
 * Uses userId (falling back to IP) as the key for authenticated routes,
 * or default IP-based keying for unauthenticated routes.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message: string;
  keyByUser?: boolean;
}) {
  return rateLimit({
    windowMs: options.windowMs,
    max: options.max,
    message: { error: options.message, code: "RATE_LIMITED" },
    standardHeaders: true,
    legacyHeaders: false,
    // Always key through ipKeyGenerator — the library default reads req.ip
    // only, which would strand the keyByUser:false (auth/webhook) limiters
    // on the proxy-hop-dependent path the X-Real-IP preference exists for.
    keyGenerator:
      options.keyByUser !== false
        ? (req: Request) => req.userId || ipKeyGenerator(req)
        : ipKeyGenerator,
  });
}

// --- Auth (IP-keyed, no userId available) ---
export const loginLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts, please try again later",
  keyByUser: false,
});

/**
 * Normalize an unvalidated `req.body.username` into a stable rate-limit key
 * fragment. Runs at keyGenerator time — BEFORE Zod validation — so the value
 * may be any JSON type; String() coercion never throws on JSON-derived values
 * (an object becomes "[object object]", a harmless shared bucket). The length
 * cap bounds memory per key; trim+lowercase collapses cosmetic variants of
 * the same account. Returns null when no usable username is present.
 */
export function normalizeUsernameKey(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase().slice(0, 100);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Bucket-key prefix for the per-account login throttle. Exported so the
 * real-limiter tests can reconstruct the exact store key to reset between
 * cases (the limiter's MemoryStore persists for the module's lifetime) without
 * hardcoding — keeping test resets in lockstep with the production keyGenerator
 * below. The prefix also prevents cross-bucket collisions with IP-keyed entries
 * when a username happens to look like an IP.
 */
export const LOGIN_ACCOUNT_KEY_PREFIX = "login-account:";

/**
 * Per-account login throttle: keys FAILED login attempts by normalized
 * username so a distributed attacker rotating source IPs against one account
 * is still throttled (the IP-keyed loginLimiter above stays in place — the
 * two layers compose). skipSuccessfulRequests un-counts responses < 400, so
 * successful logins never accumulate toward the lockout. The message/shape
 * is byte-identical to loginLimiter's 429 (no account-existence oracle).
 * Defined inline rather than via createRateLimiter because it needs a
 * body-derived keyGenerator (the documented factory exception). The window
 * is deliberately a short backoff (not a hard lockout) and the threshold is
 * well above typical typo counts, limiting account-lockout DoS impact.
 * In-memory store is fine on the current single Railway instance.
 */
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: {
    error: "Too many login attempts, please try again later",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    const username = normalizeUsernameKey(
      (req.body as { username?: unknown } | undefined)?.username,
    );
    // Prefix prevents cross-bucket collisions with IP-keyed entries when a
    // username happens to look like an IP. Requests with no usable username
    // fall back to the per-IP key (they can never match a real account, but
    // must not all share one global bucket an attacker could poison).
    return username
      ? `${LOGIN_ACCOUNT_KEY_PREFIX}${username}`
      : ipKeyGenerator(req);
  },
});

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts, please try again later",
  keyByUser: false,
});

// Unauthenticated; does a JWT-verify + DB write per call — IP-keyed guard.
export const verifyEmailLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many verification attempts, please try again later",
  keyByUser: false,
});

// Unauthenticated; triggers an outbound email — IP-keyed guard. The per-recipient
// cap in services/email.ts is the second layer (this IP key is rotatable).
export const resendVerificationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many resend requests, please try again later",
  keyByUser: false,
});

export const accountDeletionLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many account deletion attempts, please try again later",
  keyByUser: false,
});

// Authenticated, password-gated, and triggers an outbound email — user-keyed
// (the default) so the limit follows the account, and capped low like the other
// sensitive auth actions. The per-recipient cap in services/email.ts is the
// second layer against email-bombing a victim's inbox via the new-address send.
export const changeEmailLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many email change attempts. Please wait.",
});

// --- Store webhooks (IP-keyed; called by Apple/Google stores, not users) ---
export const webhookRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 100,
  message: "Too many webhook requests",
  keyByUser: false,
});

// --- User-keyed rate limiters ---
export const photoRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many photo uploads. Please wait.",
});

export const suggestionsRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many suggestion requests. Please wait.",
});

export const instructionsRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many instruction requests. Please wait.",
});

export const nutritionLookupRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: "Too many nutrition lookups. Please wait.",
});

export const subscriptionRateLimit = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many subscription requests. Please wait.",
});

export const pantryRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many pantry requests. Please wait.",
});

export const mealConfirmRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many confirmation requests. Please wait.",
});

export const mealPlanRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many meal plan requests. Please wait.",
});

export const mealSuggestionRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many suggestion requests. Please wait.",
});

export const pantryMealPlanRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 2,
  message: "Too many meal plan generation requests. Please wait.",
});

export const recipeGenerationRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 3,
  message: "Too many recipe generation requests. Please wait.",
});

export const avatarRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many avatar uploads. Please wait.",
});

export const urlImportRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many import requests. Please wait.",
});

// CCPA/PIPEDA data-portability export — limited to 2 per hour per user.
// The aggregation query is expensive and the resulting payload is large.
export const exportRateLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 2,
  message: "Too many export requests. Please wait an hour before retrying.",
});

// --- General-purpose CRUD rate limiter (for routes without a domain-specific one) ---
export const crudRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many requests. Please wait.",
});

// --- Route-specific rate limiters (consolidated from route files) ---
export const menuRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  message: "Too many menu scan requests. Please wait.",
});

export const chatRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many chat requests. Please wait.",
});

export const micronutrientRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many micronutrient requests. Please wait.",
});

export const foodParseRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many food parse requests. Please wait.",
});

export const allergenCheckRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many allergen check requests. Please wait.",
});

export const remindersPendingRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: "Too many reminder requests. Please wait.",
});

export const remindersAcknowledgeRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many acknowledge requests. Please wait.",
});

export const remindersMutesRateLimit = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: "Too many mute requests. Please wait.",
});
