import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { eq } from "drizzle-orm";
import type { WeeklyReportContent } from "@shared/schemas/coach-weekly-report";
import { createMockWeeklyFacts } from "../../__tests__/factories";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const wr = await import("../weekly-reports");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const FROM = new Date("2026-11-01T00:00:00Z");
const TO = new Date("2026-11-08T00:00:00Z");
const IN_RANGE = new Date("2026-11-03T12:00:00Z");

const content: WeeklyReportContent = {
  headline: "You showed up 3 of 7 days this week.",
  wins: [],
  watch: [],
  next: null,
  fromLogged: null,
  trendLine: null,
};
const facts = (weekStart: string, mealsLogged = 3) =>
  createMockWeeklyFacts({ weekStart, weekEnd: weekStart, mealsLogged });

const row = (weekStart: string, extra: Record<string, unknown> = {}) => ({
  weekStart,
  weekEnd: weekStart,
  facts: facts(weekStart),
  content,
  source: "template" as const,
  pushDueAt: null as Date | null,
  ...extra,
});

describe("weekly-reports storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    await tx
      .update(schema.users)
      .set({
        dailyCalorieGoal: 2000,
        dailyProteinGoal: 120,
        dailyCarbsGoal: null,
      })
      .where(eq(schema.users.id, user.id));
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("reports", () => {
    it("inserts once per week; a second insert returns null", async () => {
      const a = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      const b = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      expect(a?.id).toBeTypeOf("number");
      expect(b).toBeNull();
    });

    it("reports whether a week already has a report", async () => {
      expect(await wr.weeklyReportExists(user.id, "2026-11-01")).toBe(false);
      await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      expect(await wr.weeklyReportExists(user.id, "2026-11-01")).toBe(true);
      expect(await wr.weeklyReportExists(user.id, "2026-10-25")).toBe(false);
    });

    it("claims delivery once", async () => {
      const r = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      expect(await wr.claimWeeklyReportDelivery(user.id, r!.id, "push")).toBe(
        true,
      );
      expect(await wr.claimWeeklyReportDelivery(user.id, r!.id, "popup")).toBe(
        false,
      );
    });

    it("releasing a push claim hands the report to the popup path", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      expect(await wr.getPendingPopup(user.id)).toBeNull();
      await wr.claimWeeklyReportDelivery(user.id, r!.id, "push");
      await wr.releaseWeeklyReportDelivery(user.id, r!.id);
      expect((await wr.getPendingPopup(user.id))?.id).toBe(r!.id);
    });

    it("never returns another user's report (IDOR)", async () => {
      const other = await createTestUser(tx);
      const r = await wr.insertWeeklyReport(other.id, row("2026-11-01"));
      expect(await wr.getWeeklyReport(user.id, r!.id)).toBeNull();
      expect(await wr.claimWeeklyReportDelivery(user.id, r!.id, "popup")).toBe(
        false,
      );
      expect(await wr.markWeeklyReportSeen(user.id, r!.id)).toBe(false);
    });

    it("lists newest first and returns recent facts before a week", async () => {
      await wr.insertWeeklyReport(user.id, row("2026-10-18"));
      await wr.insertWeeklyReport(user.id, row("2026-10-25"));
      await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      const list = await wr.listWeeklyReports(user.id);
      expect(list.map((r) => r.weekStart)).toEqual([
        "2026-11-01",
        "2026-10-25",
        "2026-10-18",
      ]);
      const recent = await wr.getRecentWeeklyFacts(user.id, "2026-11-01", 6);
      expect(recent.map((f) => f.weekStart)).toEqual([
        "2026-10-25",
        "2026-10-18",
      ]);
    });

    it("marks seen and celebration once", async () => {
      const r = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      expect(await wr.markWeeklyReportSeen(user.id, r!.id)).toBe(true);
      expect(await wr.markWeeklyReportSeen(user.id, r!.id)).toBe(false);
      expect(await wr.markCelebrationShown(user.id, r!.id)).toBe(true);
      expect(await wr.markCelebrationShown(user.id, r!.id)).toBe(false);
    });

    it("lists pushes that are due and not delivered", async () => {
      const due = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      await wr.insertWeeklyReport(
        user.id,
        row("2026-10-25", { pushDueAt: new Date("2026-11-09T09:00:00Z") }),
      );
      const list = await wr.getDuePushes(new Date("2026-11-08T19:00:00Z"));
      const mine = list.filter((p) => p.userId === user.id);
      expect(mine).toEqual([
        { userId: user.id, id: due!.id, headline: content.headline },
      ]);
    });
  });

  describe("settings", () => {
    it("defaults to both on, and upserts a partial change", async () => {
      expect(await wr.getWeeklyReportSettings(user.id)).toEqual({
        reportEnabled: true,
        pushEnabled: true,
      });
      await wr.setWeeklyReportSettings(user.id, { pushEnabled: false });
      expect(await wr.getWeeklyReportSettings(user.id)).toEqual({
        reportEnabled: true,
        pushEnabled: false,
      });
      await wr.setWeeklyReportSettings(user.id, { reportEnabled: false });
      expect(await wr.getWeeklyReportSettings(user.id)).toEqual({
        reportEnabled: false,
        pushEnabled: false,
      });
    });
  });

  describe("inputs", () => {
    it("reads goals, scales a scan log by servings and keeps the meal type", async () => {
      const [scan] = await tx
        .insert(schema.scannedItems)
        .values({
          userId: user.id,
          productName: "Yoghurt",
          calories: "150",
          protein: "15",
          carbs: "10",
        })
        .returning();
      await tx.insert(schema.dailyLogs).values({
        userId: user.id,
        scannedItemId: scan.id,
        servings: "2",
        mealType: "breakfast",
        loggedAt: IN_RANGE,
      });
      await tx.insert(schema.dailyLogs).values({
        userId: user.id,
        scannedItemId: scan.id,
        servings: "1",
        loggedAt: new Date("2026-11-09T12:00:00Z"), // out of range
      });
      const inputs = await wr.getWeeklyReportInputs(user.id, FROM, TO);
      expect(inputs.goals).toEqual({
        calories: 2000,
        protein: 120,
        carbs: null,
      });
      expect(inputs.logs).toHaveLength(1);
      expect(inputs.logs[0]).toMatchObject({
        mealType: "breakfast",
        calories: 300,
        protein: 30,
        carbs: 20,
      });
    });

    it("lists imported recipes in range with times logged, excluding soft-deleted ones", async () => {
      const [kept] = await tx
        .insert(schema.mealPlanRecipes)
        .values({
          userId: user.id,
          title: "Lentil stew",
          sourceType: "url_import",
          createdAt: IN_RANGE,
          proteinPerServing: "20",
        })
        .returning();
      await tx.insert(schema.mealPlanRecipes).values({
        userId: user.id,
        title: "Gone",
        sourceType: "url_import",
        createdAt: IN_RANGE,
        deletedAt: IN_RANGE,
      });
      await tx.insert(schema.mealPlanRecipes).values({
        userId: user.id,
        title: "Mine",
        sourceType: "user_created",
        createdAt: IN_RANGE,
      });
      for (let i = 0; i < 2; i++) {
        await tx.insert(schema.dailyLogs).values({
          userId: user.id,
          recipeId: kept.id,
          servings: "1",
          loggedAt: IN_RANGE,
        });
      }
      const inputs = await wr.getWeeklyReportInputs(user.id, FROM, TO);
      expect(inputs.recipes).toEqual([
        {
          recipeId: kept.id,
          recipeType: "mealPlan",
          title: "Lentil stew",
          how: "imported",
          timesLogged: 2,
          imageUrl: null,
        },
      ]);
      // recipe logs take nutrition from the recipe × servings
      expect(inputs.logs.map((l) => l.protein)).toEqual([20, 20]);
    });

    it("reads this user's coach messages in range, not other chats", async () => {
      const [coach] = await tx
        .insert(schema.chatConversations)
        .values({ userId: user.id, title: "Coach", type: "coach" })
        .returning();
      const [other] = await tx
        .insert(schema.chatConversations)
        .values({ userId: user.id, title: "Recipe", type: "recipe" })
        .returning();
      await tx.insert(schema.chatMessages).values([
        {
          conversationId: coach.id,
          role: "user",
          content: "hello coach",
          createdAt: IN_RANGE,
        },
        {
          conversationId: coach.id,
          role: "assistant",
          content: "hi",
          createdAt: IN_RANGE,
        },
        {
          conversationId: other.id,
          role: "user",
          content: "not coach",
          createdAt: IN_RANGE,
        },
      ]);
      const inputs = await wr.getWeeklyReportInputs(user.id, FROM, TO);
      expect(inputs.coachMessages).toEqual(["hello coach"]);
    });

    it("reports feature usage", async () => {
      expect((await wr.getFeatureUsage(user.id)).barcode).toBe(false);
      await tx.insert(schema.scannedItems).values({
        userId: user.id,
        productName: "Cereal",
        sourceType: "barcode",
      });
      const usage = await wr.getFeatureUsage(user.id);
      expect(usage.barcode).toBe(true);
      expect(usage.photo).toBe(false);
      expect(usage.pantry).toBe(false);
    });
  });
});
