/**
 * Centralized environment variable validation.
 *
 * Call validateEnv() at server startup to fail fast with clear messages
 * when required variables are missing. Optional variables are logged as
 * warnings so operators know which features are degraded.
 */
import { z } from "zod";

const envSchema = z.object({
  // Required — server will not start without these
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),

  // Optional with defaults
  PORT: z.string().default("3000"),
  NODE_ENV: z.string().default("development"),

  // Optional — features degrade gracefully without these
  AI_INTEGRATIONS_OPENAI_API_KEY: z.string().optional(),
  SPOONACULAR_API_KEY: z.string().optional(),
  USDA_API_KEY: z.string().optional(),
  API_NINJAS_KEY: z.string().optional(),
  EXPO_PUBLIC_DOMAIN: z.string().optional(),

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

  // Admin
  ADMIN_USER_IDS: z.string().optional(),
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
  if (
    validated.RECEIPT_VALIDATION_STUB === "true" &&
    validated.NODE_ENV === "production"
  ) {
    warnings.push(
      "RECEIPT_VALIDATION_STUB=true in production — receipts auto-approved!",
    );
  }

  for (const w of warnings) {
    console.warn(`[env] ${w}`);
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
