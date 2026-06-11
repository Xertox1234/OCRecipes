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

export const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many registration attempts, please try again later",
  keyByUser: false,
});

export const accountDeletionLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many account deletion attempts, please try again later",
  keyByUser: false,
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
