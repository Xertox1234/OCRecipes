import { eq, and, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys, apiKeyUsage, barcodeNutrition } from "@shared/schema";
import bcrypt from "bcrypt";
import crypto from "node:crypto";

const BCRYPT_ROUNDS = 10;
// Must capture "ocr_live_" (9 chars) + enough random hex to be unique.
// varchar(16) column constraint → 16 chars = "ocr_live_" + 7 hex = 268M unique prefixes.
const KEY_PREFIX_LENGTH = 16;

/**
 * Generate a new API key with format: ocr_live_ + 32 hex chars.
 * Returns the plaintext key (shown once) and stores prefix + bcrypt hash.
 */
export async function createApiKey(
  name: string,
  tier: string,
  ownerId: string,
): Promise<{ id: number; keyPrefix: string; plaintextKey: string }> {
  const randomPart = crypto.randomBytes(16).toString("hex");
  const plaintextKey = `ocr_live_${randomPart}`;
  const keyPrefix = plaintextKey.substring(0, KEY_PREFIX_LENGTH);
  const keyHash = await bcrypt.hash(plaintextKey, BCRYPT_ROUNDS);

  const [row] = await db
    .insert(apiKeys)
    .values({ keyPrefix, keyHash, name, tier, ownerId })
    .returning({ id: apiKeys.id });

  return { id: row.id, keyPrefix, plaintextKey };
}

/** Look up an API key row by its prefix (for subsequent bcrypt verification) */
export async function getApiKeyByPrefix(prefix: string) {
  const [result] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyPrefix, prefix));
  return result ?? null;
}

/** Revoke an API key immediately */
export async function revokeApiKey(id: number): Promise<void> {
  await db
    .update(apiKeys)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(apiKeys.id, id));
}

/** Update an API key's tier */
export async function updateApiKeyTier(
  id: number,
  tier: string,
): Promise<void> {
  await db.update(apiKeys).set({ tier }).where(eq(apiKeys.id, id));
}

/** List API keys, optionally filtered by owner */
export async function listApiKeys(ownerId?: string) {
  if (ownerId) {
    return db.select().from(apiKeys).where(eq(apiKeys.ownerId, ownerId));
  }
  return db.select().from(apiKeys);
}

/** Get a single API key by ID */
export async function getApiKey(id: number) {
  const [result] = await db.select().from(apiKeys).where(eq(apiKeys.id, id));
  return result ?? null;
}

/**
 * Atomically increment the request count for an API key in the current month.
 * Uses INSERT ... ON CONFLICT DO UPDATE for upsert semantics.
 */
export async function incrementUsage(apiKeyId: number): Promise<void> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  await db
    .insert(apiKeyUsage)
    .values({ apiKeyId, yearMonth, requestCount: 1, lastRequestAt: now })
    .onConflictDoUpdate({
      target: [apiKeyUsage.apiKeyId, apiKeyUsage.yearMonth],
      set: {
        requestCount: sql`${apiKeyUsage.requestCount} + 1`,
        lastRequestAt: now,
      },
    });
}

/** Get the current month's usage for an API key */
export async function getUsage(
  apiKeyId: number,
  yearMonth?: string,
): Promise<number> {
  const ym =
    yearMonth ??
    (() => {
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    })();

  const [result] = await db
    .select({ requestCount: apiKeyUsage.requestCount })
    .from(apiKeyUsage)
    .where(
      and(eq(apiKeyUsage.apiKeyId, apiKeyId), eq(apiKeyUsage.yearMonth, ym)),
    );

  return result?.requestCount ?? 0;
}

/** Get usage stats for an API key (for admin listing) */
export async function getUsageStats(apiKeyId: number) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const count = await getUsage(apiKeyId, yearMonth);
  return { yearMonth, requestCount: count };
}

// ── Barcode Nutrition (unverified product data for free tier) ──────

/**
 * Store barcode nutrition data. Uses onConflictDoNothing for idempotent inserts
 * — existing data is never overwritten by newer scans.
 */
export async function upsertBarcodeNutrition(data: {
  barcode: string;
  productName?: string | null;
  brandName?: string | null;
  servingSize?: string | null;
  calories?: string | null;
  protein?: string | null;
  carbs?: string | null;
  fat?: string | null;
  source: string;
}): Promise<void> {
  await db
    .insert(barcodeNutrition)
    .values({
      barcode: data.barcode,
      productName: data.productName ?? null,
      brandName: data.brandName ?? null,
      servingSize: data.servingSize ?? null,
      calories: data.calories ?? null,
      protein: data.protein ?? null,
      carbs: data.carbs ?? null,
      fat: data.fat ?? null,
      source: data.source,
    })
    .onConflictDoNothing();
}

/**
 * Look up barcode nutrition by trying multiple barcode variants.
 * Returns the first match found, or null.
 */
export async function getBarcodeNutrition(variants: string[]) {
  for (const variant of variants) {
    const [result] = await db
      .select()
      .from(barcodeNutrition)
      .where(eq(barcodeNutrition.barcode, variant));
    if (result) return result;
  }
  return null;
}
