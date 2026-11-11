import {
  chatConversations,
  chatMessages,
  coachWeeklyReportSettings,
  coachWeeklyReports,
  communityRecipes,
  cookbooks,
  dailyLogs,
  favouriteRecipes,
  groceryLists,
  mealPlanItems,
  mealPlanRecipes,
  pantryItems,
  recipeGenerationLog,
  savedItems,
  scannedItems,
  users,
  type CoachWeeklyReport,
} from "@shared/schema";
import type {
  FeatureTipId,
  WeeklyFacts,
  WeeklyInputs,
  WeeklyRecipe,
  WeeklyReportContent,
  WeeklyReportSettings,
} from "@shared/schemas/coach-weekly-report";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { logNutrientSql } from "./nutrition";

/**
 * Storage for the Coach weekly report
 * (spec docs/superpowers/specs/2026-11-10-coach-weekly-report-design.md).
 * Every read and write is scoped by userId, except getDuePushes, the
 * scheduler's cross-user batch.
 */

const IMPORT_SOURCE_TYPES = ["url_import", "photo_import"];

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function positiveOrNull(v: number | null | undefined): number | null {
  return v !== null && v !== undefined && v > 0 ? v : null;
}

// ── Inputs ──────────────────────────────────────────────────────────────

export async function getWeeklyReportInputs(
  userId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<Omit<WeeklyInputs, "previous" | "tipIds">> {
  const [user] = await db
    .select({
      calories: users.dailyCalorieGoal,
      protein: users.dailyProteinGoal,
      carbs: users.dailyCarbsGoal,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const inRange = (col: typeof dailyLogs.loggedAt) =>
    and(gte(col, fromUtc), lt(col, toUtc));

  const logRows = await db
    .select({
      loggedAt: dailyLogs.loggedAt,
      mealType: dailyLogs.mealType,
      calories: logNutrientSql("calories"),
      protein: logNutrientSql("protein"),
      carbs: logNutrientSql("carbs"),
    })
    .from(dailyLogs)
    .leftJoin(scannedItems, eq(dailyLogs.scannedItemId, scannedItems.id))
    .leftJoin(mealPlanRecipes, eq(dailyLogs.recipeId, mealPlanRecipes.id))
    .where(
      and(
        eq(dailyLogs.userId, userId),
        inRange(dailyLogs.loggedAt),
        sql`(${scannedItems.discardedAt} IS NULL OR ${dailyLogs.scannedItemId} IS NULL)`,
      ),
    )
    .orderBy(dailyLogs.loggedAt);

  const logs = logRows.map((r) => ({
    loggedAt: r.loggedAt,
    mealType: r.mealType,
    calories: num(r.calories),
    protein: num(r.protein),
    carbs: num(r.carbs),
  }));

  const recipes = await getWeeklyRecipes(userId, fromUtc, toUtc);

  const messages = await db
    .select({ content: chatMessages.content })
    .from(chatMessages)
    .innerJoin(
      chatConversations,
      eq(chatMessages.conversationId, chatConversations.id),
    )
    .where(
      and(
        eq(chatConversations.userId, userId),
        eq(chatConversations.type, "coach"),
        eq(chatMessages.role, "user"),
        gte(chatMessages.createdAt, fromUtc),
        lt(chatMessages.createdAt, toUtc),
      ),
    )
    .orderBy(chatMessages.createdAt);

  return {
    // A saved goal of 0 (the goals form allows it) means "no goal".
    goals: {
      calories: positiveOrNull(user?.calories),
      protein: positiveOrNull(user?.protein),
      carbs: positiveOrNull(user?.carbs),
    },
    logs,
    recipes,
    coachMessages: messages.map((m) => m.content),
  };
}

/** Recipes imported, saved or favourited in the week; imported wins a tie. */
async function getWeeklyRecipes(
  userId: string,
  fromUtc: Date,
  toUtc: Date,
): Promise<WeeklyRecipe[]> {
  const imports = await db
    .select({
      id: mealPlanRecipes.id,
      title: mealPlanRecipes.title,
      imageUrl: mealPlanRecipes.imageUrl,
    })
    .from(mealPlanRecipes)
    .where(
      and(
        eq(mealPlanRecipes.userId, userId),
        inArray(mealPlanRecipes.sourceType, IMPORT_SOURCE_TYPES),
        isNull(mealPlanRecipes.deletedAt),
        gte(mealPlanRecipes.createdAt, fromUtc),
        lt(mealPlanRecipes.createdAt, toUtc),
      ),
    );

  const saved = await db
    .select({
      recipeId: savedItems.recipeId,
      recipeType: savedItems.recipeType,
    })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.userId, userId),
        eq(savedItems.type, "recipe"),
        gte(savedItems.createdAt, fromUtc),
        lt(savedItems.createdAt, toUtc),
      ),
    );

  const favourites = await db
    .select({
      recipeId: favouriteRecipes.recipeId,
      recipeType: favouriteRecipes.recipeType,
    })
    .from(favouriteRecipes)
    .where(
      and(
        eq(favouriteRecipes.userId, userId),
        gte(favouriteRecipes.createdAt, fromUtc),
        lt(favouriteRecipes.createdAt, toUtc),
      ),
    );

  type Ref = {
    id: number;
    type: "mealPlan" | "community";
    how: WeeklyRecipe["how"];
  };
  const refs = new Map<string, Ref>();
  const add = (id: number | null, type: string | null, how: Ref["how"]) => {
    if (id === null || (type !== "mealPlan" && type !== "community")) return;
    const key = `${type}:${id}`;
    if (!refs.has(key)) refs.set(key, { id, type, how });
  };
  for (const r of imports) add(r.id, "mealPlan", "imported");
  for (const r of saved) add(r.recipeId, r.recipeType, "saved");
  for (const r of favourites) add(r.recipeId, r.recipeType, "favourited");
  if (refs.size === 0) return [];

  const mealPlanIds = [...refs.values()]
    .filter((r) => r.type === "mealPlan")
    .map((r) => r.id);
  const communityIds = [...refs.values()]
    .filter((r) => r.type === "community")
    .map((r) => r.id);

  const details = new Map<string, { title: string; imageUrl: string | null }>();
  if (mealPlanIds.length > 0) {
    const rows = await db
      .select({
        id: mealPlanRecipes.id,
        title: mealPlanRecipes.title,
        imageUrl: mealPlanRecipes.imageUrl,
      })
      .from(mealPlanRecipes)
      .where(
        and(
          eq(mealPlanRecipes.userId, userId),
          inArray(mealPlanRecipes.id, mealPlanIds),
          isNull(mealPlanRecipes.deletedAt),
        ),
      );
    for (const r of rows) details.set(`mealPlan:${r.id}`, r);
  }
  if (communityIds.length > 0) {
    const rows = await db
      .select({
        id: communityRecipes.id,
        title: communityRecipes.title,
        imageUrl: communityRecipes.imageUrl,
      })
      .from(communityRecipes)
      .where(inArray(communityRecipes.id, communityIds));
    for (const r of rows) details.set(`community:${r.id}`, r);
  }

  const logged = new Map<number, number>();
  if (mealPlanIds.length > 0) {
    const rows = await db
      .select({
        recipeId: dailyLogs.recipeId,
        n: sql<number>`count(*)::int`,
      })
      .from(dailyLogs)
      .where(
        and(
          eq(dailyLogs.userId, userId),
          inArray(dailyLogs.recipeId, mealPlanIds),
          gte(dailyLogs.loggedAt, fromUtc),
          lt(dailyLogs.loggedAt, toUtc),
        ),
      )
      .groupBy(dailyLogs.recipeId);
    for (const r of rows) if (r.recipeId !== null) logged.set(r.recipeId, r.n);
  }

  const out: WeeklyRecipe[] = [];
  for (const [key, ref] of refs) {
    const d = details.get(key);
    if (!d) continue; // deleted or unreadable since
    out.push({
      recipeId: ref.id,
      recipeType: ref.type,
      title: d.title,
      how: ref.how,
      timesLogged: ref.type === "mealPlan" ? (logged.get(ref.id) ?? 0) : 0,
      imageUrl: d.imageUrl,
    });
  }
  return out;
}

export async function getFeatureUsage(
  userId: string,
): Promise<Record<FeatureTipId, boolean>> {
  const exists = (q: ReturnType<typeof sql>) => sql<boolean>`EXISTS (${q})`;
  const [row] = await db
    .select({
      barcode: exists(
        sql`SELECT 1 FROM ${scannedItems} WHERE ${scannedItems.userId} = ${userId} AND ${scannedItems.sourceType} = 'barcode'`,
      ),
      photo: exists(
        sql`SELECT 1 FROM ${scannedItems} WHERE ${scannedItems.userId} = ${userId} AND ${scannedItems.sourceType} = 'photo'`,
      ),
      import: exists(
        sql`SELECT 1 FROM ${mealPlanRecipes} WHERE ${mealPlanRecipes.userId} = ${userId} AND ${mealPlanRecipes.sourceType} IN ('url_import', 'photo_import')`,
      ),
      pantry: exists(
        sql`SELECT 1 FROM ${pantryItems} WHERE ${pantryItems.userId} = ${userId}`,
      ),
      mealPlan: exists(
        sql`SELECT 1 FROM ${mealPlanItems} WHERE ${mealPlanItems.userId} = ${userId}`,
      ),
      voice: exists(
        sql`SELECT 1 FROM ${recipeGenerationLog} WHERE ${recipeGenerationLog.userId} = ${userId} AND ${recipeGenerationLog.kind} = 'voiceTranscription'`,
      ),
      cookbooks: exists(
        sql`SELECT 1 FROM ${cookbooks} WHERE ${cookbooks.userId} = ${userId}`,
      ),
      grocery: exists(
        sql`SELECT 1 FROM ${groceryLists} WHERE ${groceryLists.userId} = ${userId}`,
      ),
    })
    .from(sql`(SELECT 1) AS one`);
  return {
    barcode: Boolean(row?.barcode),
    photo: Boolean(row?.photo),
    import: Boolean(row?.import),
    pantry: Boolean(row?.pantry),
    // A grocery list built from a plan counts as using the meal planner.
    mealPlan: Boolean(row?.mealPlan) || Boolean(row?.grocery),
    voice: Boolean(row?.voice),
    cookbooks: Boolean(row?.cookbooks),
  };
}

// ── Reports ─────────────────────────────────────────────────────────────

export interface NewWeeklyReport {
  weekStart: string;
  weekEnd: string;
  facts: WeeklyFacts;
  content: WeeklyReportContent;
  source: "ai" | "template";
  pushDueAt: Date | null;
}

/** Null when this user already has a report for the week. */
export async function insertWeeklyReport(
  userId: string,
  report: NewWeeklyReport,
): Promise<{ id: number } | null> {
  const [row] = await db
    .insert(coachWeeklyReports)
    .values({ userId, ...report })
    .onConflictDoNothing({
      target: [coachWeeklyReports.userId, coachWeeklyReports.weekStart],
    })
    .returning({ id: coachWeeklyReports.id });
  return row ?? null;
}

export async function weeklyReportExists(
  userId: string,
  weekStart: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: coachWeeklyReports.id })
    .from(coachWeeklyReports)
    .where(
      and(
        eq(coachWeeklyReports.userId, userId),
        eq(coachWeeklyReports.weekStart, weekStart),
      ),
    )
    .limit(1);
  return !!row;
}

export async function listWeeklyReports(
  userId: string,
  limit = 60,
): Promise<CoachWeeklyReport[]> {
  return db
    .select()
    .from(coachWeeklyReports)
    .where(eq(coachWeeklyReports.userId, userId))
    .orderBy(desc(coachWeeklyReports.weekStart))
    .limit(limit);
}

export async function getWeeklyReport(
  userId: string,
  id: number,
): Promise<CoachWeeklyReport | null> {
  const [row] = await db
    .select()
    .from(coachWeeklyReports)
    .where(
      and(eq(coachWeeklyReports.id, id), eq(coachWeeklyReports.userId, userId)),
    )
    .limit(1);
  return row ?? null;
}

/** Facts of the reports before `beforeWeekStart`, newest first. */
export async function getRecentWeeklyFacts(
  userId: string,
  beforeWeekStart: string,
  n = 6,
): Promise<WeeklyFacts[]> {
  const rows = await db
    .select({ facts: coachWeeklyReports.facts })
    .from(coachWeeklyReports)
    .where(
      and(
        eq(coachWeeklyReports.userId, userId),
        lt(coachWeeklyReports.weekStart, beforeWeekStart),
      ),
    )
    .orderBy(desc(coachWeeklyReports.weekStart))
    .limit(n);
  return rows.map((r) => r.facts);
}

async function setOnce(
  userId: string,
  id: number,
  column: "seenAt" | "celebrationShownAt",
): Promise<boolean> {
  const rows = await db
    .update(coachWeeklyReports)
    .set({ [column]: new Date() })
    .where(
      and(
        eq(coachWeeklyReports.id, id),
        eq(coachWeeklyReports.userId, userId),
        isNull(coachWeeklyReports[column]),
      ),
    )
    .returning({ id: coachWeeklyReports.id });
  return rows.length > 0;
}

export function markWeeklyReportSeen(userId: string, id: number) {
  return setOnce(userId, id, "seenAt");
}

export function markCelebrationShown(userId: string, id: number) {
  return setOnce(userId, id, "celebrationShownAt");
}

/** True only for the first claimer: a push and a popup never both fire. */
export async function claimWeeklyReportDelivery(
  userId: string,
  id: number,
  via: "push" | "popup",
): Promise<boolean> {
  const rows = await db
    .update(coachWeeklyReports)
    .set({ deliveredVia: via, deliveredAt: new Date() })
    .where(
      and(
        eq(coachWeeklyReports.id, id),
        eq(coachWeeklyReports.userId, userId),
        isNull(coachWeeklyReports.deliveredVia),
      ),
    )
    .returning({ id: coachWeeklyReports.id });
  return rows.length > 0;
}

/**
 * Undo a push claim whose push did not reach a device, and clear the push so
 * the in-app popup takes over.
 */
export async function releaseWeeklyReportDelivery(
  userId: string,
  id: number,
): Promise<void> {
  await db
    .update(coachWeeklyReports)
    .set({ deliveredVia: null, deliveredAt: null, pushDueAt: null })
    .where(
      and(
        eq(coachWeeklyReports.id, id),
        eq(coachWeeklyReports.userId, userId),
        eq(coachWeeklyReports.deliveredVia, "push"),
      ),
    );
}

export async function getDuePushes( // idor-safe: scheduler's cross-user batch; each row carries its own userId and the claim re-checks it
  now: Date,
  limit = 500,
): Promise<{ userId: string; id: number; headline: string }[]> {
  const rows = await db
    .select({
      userId: coachWeeklyReports.userId,
      id: coachWeeklyReports.id,
      content: coachWeeklyReports.content,
    })
    .from(coachWeeklyReports)
    .where(
      and(
        lte(coachWeeklyReports.pushDueAt, now),
        isNull(coachWeeklyReports.deliveredVia),
      ),
    )
    .orderBy(coachWeeklyReports.pushDueAt)
    .limit(limit);
  return rows.map((r) => ({
    userId: r.userId,
    id: r.id,
    headline: r.content.headline,
  }));
}

/** The newest undelivered report that no push is waiting to announce. */
export async function getPendingPopup(
  userId: string,
): Promise<CoachWeeklyReport | null> {
  const [row] = await db
    .select()
    .from(coachWeeklyReports)
    .where(
      and(
        eq(coachWeeklyReports.userId, userId),
        isNull(coachWeeklyReports.deliveredVia),
        isNull(coachWeeklyReports.pushDueAt),
      ),
    )
    .orderBy(desc(coachWeeklyReports.weekStart))
    .limit(1);
  return row ?? null;
}

// ── Settings ────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: WeeklyReportSettings = {
  reportEnabled: true,
  pushEnabled: true,
};

export async function getWeeklyReportSettings(
  userId: string,
): Promise<WeeklyReportSettings> {
  const [row] = await db
    .select({
      reportEnabled: coachWeeklyReportSettings.reportEnabled,
      pushEnabled: coachWeeklyReportSettings.pushEnabled,
    })
    .from(coachWeeklyReportSettings)
    .where(eq(coachWeeklyReportSettings.userId, userId))
    .limit(1);
  return row ?? { ...DEFAULT_SETTINGS };
}

export async function setWeeklyReportSettings(
  userId: string,
  partial: Partial<WeeklyReportSettings>,
): Promise<WeeklyReportSettings> {
  const [row] = await db
    .insert(coachWeeklyReportSettings)
    .values({ userId, ...DEFAULT_SETTINGS, ...partial })
    .onConflictDoUpdate({
      target: coachWeeklyReportSettings.userId,
      set: { ...partial, updatedAt: new Date() },
    })
    .returning({
      reportEnabled: coachWeeklyReportSettings.reportEnabled,
      pushEnabled: coachWeeklyReportSettings.pushEnabled,
    });
  // Turning the push off also cancels one still waiting (e.g. held to the next
  // morning); the in-app popup delivers that report instead.
  if (partial.pushEnabled === false) {
    await db
      .update(coachWeeklyReports)
      .set({ pushDueAt: null })
      .where(
        and(
          eq(coachWeeklyReports.userId, userId),
          isNull(coachWeeklyReports.deliveredVia),
        ),
      );
  }
  return row;
}
