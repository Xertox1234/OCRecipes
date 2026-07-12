/**
 * Centralized environment variable validation.
 *
 * Call validateEnv() at server startup to fail fast with clear messages
 * when required variables are missing. Optional variables are logged as
 * warnings so operators know which features are degraded.
 */
import { z } from "zod";
import { logger } from "./logger";
import { isR2Configured } from "./image-store";

const envSchema = z.object({
  // Required — server will not start without these
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters for security"),

  // Optional with defaults
  PORT: z.string().default("3000"),
  NODE_ENV: z.string().default("development"),

  // Optional — features degrade gracefully without these
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().optional(),
  AI_INTEGRATIONS_OPENAI_BASE_URL: z.string().optional(),
  SPOONACULAR_API_KEY: z.string().optional(),
  USDA_API_KEY: z.string().optional(),
  API_NINJAS_KEY: z.string().optional(),
  RUNWARE_API_KEY: z.string().optional(),

  // Cloudflare R2 image storage (required in production — see guard below)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z
    .string()
    .url()
    .startsWith("https://", {
      message:
        "R2_PUBLIC_BASE_URL must use HTTPS — stored image URLs are served " +
        "verbatim and plain HTTP becomes blocked mixed content",
    })
    .optional(),

  EXPO_PUBLIC_DOMAIN: z.string().optional(),
  // Web frontend origin for CORS allowlist (set at web launch; omit until then)
  // Must be the bare origin with no trailing slash, e.g. https://ocrecipes.app
  WEB_ORIGIN: z
    .string()
    .url()
    .startsWith("https://", {
      message:
        "WEB_ORIGIN must use HTTPS — a plain-HTTP web origin would allow " +
        "the browser's mixed-content blocker to reject API responses",
    })
    .refine((v) => !v.endsWith("/"), {
      message:
        "WEB_ORIGIN must not have a trailing slash — browsers send " +
        "'Origin: https://example.com' (no slash) and the exact-match " +
        "check would silently fail, locking the web frontend out of CORS",
    })
    .optional(),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  // Email verification via Resend (optional — when RESEND_API_KEY is unset the
  // whole verification gate is DISABLED and new users auto-login; see the
  // startup warning below so the fail-open posture is never silent in prod).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  // Base URL for the verification link. Bare origin, NO trailing slash — it is
  // concatenated as `${EMAIL_VERIFY_BASE_URL}/verify-email`, so a slash yields a
  // broken `//verify-email`. Allows http (dev localhost), unlike WEB_ORIGIN.
  EMAIL_VERIFY_BASE_URL: z
    .string()
    .url()
    .refine((v) => !v.endsWith("/"), {
      message:
        "EMAIL_VERIFY_BASE_URL must not have a trailing slash — it is " +
        "concatenated with '/verify-email', so a slash produces a broken " +
        "'//verify-email' link in the verification email",
    })
    .optional(),

  // Apple IAP (optional — receipt validation uses stub mode without these)
  APPLE_ISSUER_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  APPLE_BUNDLE_ID: z.string().optional(),
  APPLE_ENVIRONMENT: z.string().optional(),
  APPLE_APP_ID: z.string().optional(),
  APPLE_ROOT_CA_DIR: z.string().optional(),
  RECEIPT_VALIDATION_STUB: z.string().optional(),

  // Google IAP (optional)
  GOOGLE_PACKAGE_NAME: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: z.string().optional(),

  // Google Play RTDN Pub/Sub push verification (optional — RTDN webhook
  // rejects all pushes until both are set)
  GOOGLE_PUBSUB_AUDIENCE: z.string().optional(),
  GOOGLE_PUBSUB_SA_EMAIL: z.string().optional(),

  // Server-side Sentry error tracking (optional — error tracking disabled
  // without it; only active in NODE_ENV=production, mirroring the client
  // reporter contract in client/lib/reporter.ts). See server/lib/error-reporter.ts.
  SENTRY_DSN: z.string().optional(),

  // Admin
  ADMIN_USER_IDS: z.string().optional(),

  // Logging
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .optional(),
});

type Env = z.infer<typeof envSchema>;

let validated: Env | null = null;

/**
 * Validate all environment variables at startup.
 * Throws with a clear message listing all missing required vars.
 * Logs warnings for missing optional vars that degrade features.
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Environment validation failed:\n${issues}`);
  }

  validated = result.data;

  // Warn about missing optional vars that affect features
  const warnings: string[] = [];
  if (!validated.AI_INTEGRATIONS_OPENAI_API_KEY) {
    warnings.push(
      "AI_INTEGRATIONS_OPENAI_API_KEY not set — AI features disabled",
    );
  }
  if (!validated.SPOONACULAR_API_KEY) {
    warnings.push("SPOONACULAR_API_KEY not set — recipe catalog disabled");
  }
  if (!validated.USDA_API_KEY) {
    warnings.push(
      "USDA_API_KEY not set — using DEMO_KEY with severe rate limits",
    );
  }
  if (!validated.RUNWARE_API_KEY) {
    warnings.push(
      "RUNWARE_API_KEY not set — recipe image generation falls back to DALL-E",
    );
  }
  if (!validated.EXPO_ACCESS_TOKEN) {
    warnings.push(
      "EXPO_ACCESS_TOKEN not set — server-driven push notifications disabled",
    );
  }
  if (!validated.SENTRY_DSN) {
    warnings.push(
      "SENTRY_DSN not set — server-side error tracking disabled (production " +
        "5xx errors and crashes are only visible in stdout logs)",
    );
  }
  if (!validated.RESEND_API_KEY) {
    warnings.push(
      "RESEND_API_KEY not set — email verification DISABLED (new users " +
        "auto-login without verifying their email; the anti-enumeration + " +
        "verification gate in auth.ts is inert)",
    );
  }
  if (
    validated.RECEIPT_VALIDATION_STUB === "true" &&
    validated.NODE_ENV === "production"
  ) {
    throw new Error(
      "RECEIPT_VALIDATION_STUB=true is not allowed in production — receipts would be auto-approved!",
    );
  }

  // Single source of truth for "R2 is configured" — image-store owns the
  // var list, so a future sixth R2 var can't drift past this guard.
  if (!isR2Configured()) {
    if (validated.NODE_ENV === "production") {
      throw new Error(
        "R2 image storage is not configured but NODE_ENV=production — " +
          "uploaded images would be written to Railway's ephemeral disk and " +
          "lost on every redeploy. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, " +
          "R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL.",
      );
    }
    warnings.push(
      "R2 not configured — images stored on local (ephemeral) disk",
    );
  }

  for (const w of warnings) {
    logger.warn({ component: "env" }, w);
  }

  return validated;
}

/** Access validated env (throws if validateEnv() hasn't been called) */
export function getEnv(): Env {
  if (!validated) {
    throw new Error("validateEnv() must be called before getEnv()");
  }
  return validated;
}
