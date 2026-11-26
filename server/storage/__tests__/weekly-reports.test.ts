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
import { eq, sql } from "drizzle-orm";
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
      // A push claim needs a waiting push, as every sender claim has.
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
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

    // Audit 2026-11-24 L111: the list reads only what the list screen shows.
    it("lists headline, seen state and trend counters, not the full JSON", async () => {
      await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      const [item] = await wr.listWeeklyReports(user.id);
      expect(item).toEqual({
        id: expect.any(Number),
        weekStart: "2026-11-01",
        weekEnd: "2026-11-01",
        headline: content.headline,
        seenAt: null,
        proteinDaysMet: facts("2026-11-01").proteinDaysMet,
        daysActive: facts("2026-11-01").daysActive,
        recipesAdded: facts("2026-11-01").recipesAdded,
      });
    });

    // Audit 2026-11-24 L71: stored JSON is read back through its schema, so
    // a row of another shape (a future version, a hand-edited row) is
    // skipped instead of reaching the screens or the scheduler.
    it("skips a stored report whose facts no longer fit the schema", async () => {
      const good = await wr.insertWeeklyReport(user.id, row("2026-10-25"));
      const bad = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      // A version the schema does not know, written as raw SQL (the column's
      // type only allows version 1).
      await tx.execute(
        sql`UPDATE coach_weekly_reports SET facts = jsonb_set(facts, '{version}', '2') WHERE id = ${bad!.id}`,
      );
      expect(await wr.getWeeklyReport(user.id, bad!.id)).toBeNull();
      expect((await wr.getWeeklyReport(user.id, good!.id))?.id).toBe(good!.id);
      const recent = await wr.getRecentWeeklyFacts(user.id, "2026-11-08", 6);
      expect(recent.map((f) => f.weekStart)).toEqual(["2026-10-25"]);
      // The newest row is the bad one: no popup rather than a broken one.
      expect(await wr.getPendingPopup(user.id)).toBeNull();
      // Nor a list entry that would open to "not found".
      expect((await wr.listWeeklyReports(user.id)).map((r) => r.id)).toEqual([
        good!.id,
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
        {
          userId: user.id,
          id: due!.id,
          headline: content.headline,
          pushEnabled: true,
        },
      ]);
    });

    // Audit 2026-11-24 L95: a push can be waiting on a row inserted after the
    // user turned pushes off; the sender must see the current setting.
    it("a due push carries the user's current push setting", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      const at = new Date("2026-11-08T19:00:00Z");
      const find = async () =>
        (await wr.getDuePushes(at)).find((p) => p.id === r!.id);
      // No settings row: pushes are on by default (control).
      expect((await find())?.pushEnabled).toBe(true);
      await tx.insert(schema.coachWeeklyReportSettings).values({
        userId: user.id,
        reportEnabled: true,
        pushEnabled: false,
      });
      expect((await find())?.pushEnabled).toBe(false);
    });

    it("cancelling a waiting push hands the report to the popup", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      expect(await wr.getPendingPopup(user.id)).toBeNull();
      await wr.cancelWeeklyReportPush(user.id, r!.id);
      expect((await wr.getPendingPopup(user.id))?.id).toBe(r!.id);
    });

    // Audit 2026-11-24 L112: after the newest report is delivered, an older
    // undelivered one must not pop up or be pushed as "Your week is ready".
    it("only the newest report can pop up or be pushed", async () => {
      const older = await wr.insertWeeklyReport(
        user.id,
        row("2026-10-25", { pushDueAt: new Date("2026-11-01T18:00:00Z") }),
      );
      const newer = await wr.insertWeeklyReport(user.id, row("2026-11-01"));
      expect((await wr.getPendingPopup(user.id))?.id).toBe(newer!.id);
      await wr.claimWeeklyReportDelivery(user.id, newer!.id, "popup");
      expect(await wr.getPendingPopup(user.id)).toBeNull();
      const due = await wr.getDuePushes(new Date("2026-11-09T00:00:00Z"));
      expect(due.find((p) => p.id === older!.id)).toBeUndefined();
    });

    it("an older report still pops up while it is the newest (control)", async () => {
      const only = await wr.insertWeeklyReport(user.id, row("2026-10-25"));
      expect((await wr.getPendingPopup(user.id))?.id).toBe(only!.id);
    });

    // Audit 2026-11-24 L65: a push claim with no send recorded is stranded if
    // the process died between the claim and the push. The next tick hands it
    // to the popup; a push that was sent keeps its claim.
    it("releases a stale push claim with no send recorded, and keeps a sent one", async () => {
      const due = new Date("2026-11-08T18:00:00Z");
      const stranded = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: due }),
      );
      const other = await createTestUser(tx);
      const sent = await wr.insertWeeklyReport(
        other.id,
        row("2026-11-01", { pushDueAt: due }),
      );
      await wr.claimWeeklyReportDelivery(user.id, stranded!.id, "push");
      await wr.claimWeeklyReportDelivery(other.id, sent!.id, "push");
      await wr.markWeeklyReportPushSent(other.id, sent!.id);

      // A claim younger than the cutoff is left alone.
      expect(
        await wr.releaseStrandedPushClaims(new Date("2026-11-08T17:00:00Z")),
      ).toBe(0);
      expect(
        await wr.releaseStrandedPushClaims(new Date("2026-11-08T19:00:00Z")),
      ).toBe(1);
      expect((await wr.getPendingPopup(user.id))?.id).toBe(stranded!.id);
      expect(await wr.getPendingPopup(other.id)).toBeNull();
    });
  });

  describe("settings", () => {
    it("turning the push off cancels a push that is still waiting", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-09T17:00:00Z") }),
      );
      await wr.setWeeklyReportSettings(user.id, { pushEnabled: false });
      expect(
        await wr.getDuePushes(new Date("2026-11-10T00:00:00Z")),
      ).not.toContainEqual(expect.objectContaining({ id: r!.id }));
      expect((await wr.getPendingPopup(user.id))?.id).toBe(r!.id);
    });

    // L95, the window inside one send run: the batch was read while pushes
    // were on, then the user turned them off before the loop reached the row.
    it("a push cancelled after the batch was read can no longer be claimed", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      await wr.setWeeklyReportSettings(user.id, { pushEnabled: false });
      expect(await wr.claimWeeklyReportDelivery(user.id, r!.id, "push")).toBe(
        false,
      );
      // The popup can still claim it (control).
      expect(await wr.claimWeeklyReportDelivery(user.id, r!.id, "popup")).toBe(
        true,
      );
    });

    it("turning the push off never cancels a push already claimed", async () => {
      const r = await wr.insertWeeklyReport(
        user.id,
        row("2026-11-01", { pushDueAt: new Date("2026-11-08T18:00:00Z") }),
      );
      await wr.claimWeeklyReportDelivery(user.id, r!.id, "push");
      await wr.setWeeklyReportSettings(user.id, { pushEnabled: false });
      const [after] = await tx
        .select({ pushDueAt: schema.coachWeeklyReports.pushDueAt })
        .from(schema.coachWeeklyReports)
        .where(eq(schema.coachWeeklyReports.id, r!.id));
      expect(after.pushDueAt).not.toBeNull();
    });

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
    it("treats a saved goal of 0 as no goal", async () => {
      await tx
        .update(schema.users)
        .set({ dailyProteinGoal: 0, dailyCarbsGoal: 0 })
        .where(eq(schema.users.id, user.id));
      const inputs = await wr.getWeeklyReportInputs(user.id, FROM, TO);
      expect(inputs.goals.protein).toBeNull();
      expect(inputs.goals.carbs).toBeNull();
      expect(inputs.goals.calories).toBe(2000);
    });

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

    // Audit 2026-11-24 L96 (owner: scan up to writing time): the week ends
    // at Sunday 00:00 but the report is written that evening, so the safety
    // scan runs on to the moment of writing. Logs keep the week's bounds.
    it("scans coach messages up to the scan end, past the week's end", async () => {
      const [coach] = await tx
        .insert(schema.chatConversations)
        .values({ userId: user.id, title: "Coach", type: "coach" })
        .returning();
      const sundayMorning = new Date("2026-11-08T09:00:00Z"); // after TO
      const afterWriting = new Date("2026-11-08T20:00:00Z");
      await tx.insert(schema.chatMessages).values([
        {
          conversationId: coach.id,
          role: "user",
          content: "sunday morning",
          createdAt: sundayMorning,
        },
        {
          conversationId: coach.id,
          role: "user",
          content: "after writing",
          createdAt: afterWriting,
        },
      ]);
      const writingAt = new Date("2026-11-08T18:00:00Z");
      const inputs = await wr.getWeeklyReportInputs(
        user.id,
        FROM,
        TO,
        writingAt,
      );
      expect(inputs.coachMessages).toEqual(["sunday morning"]);
      // Without a scan end the week's bounds apply (control).
      const plain = await wr.getWeeklyReportInputs(user.id, FROM, TO);
      expect(plain.coachMessages).toEqual([]);
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

    // Audit 2026-11-24 L97: a community recipe favourited while public, then
    // made private by its author, must not lend its title or image.
    it("skips another author's community recipe once it is private", async () => {
      const author = await createTestUser(tx);
      const community = (title: string, authorId: string, isPublic: boolean) =>
        tx
          .insert(schema.communityRecipes)
          .values({
            authorId,
            normalizedProductName: `wr-${title}`,
            title,
            instructions: ["Step 1"],
            isPublic,
          })
          .returning()
          .then((r) => r[0]);
      const theirs = await community("Their soup", author.id, true);
      const mine = await community("My private soup", user.id, false);
      for (const r of [theirs, mine]) {
        await tx.insert(schema.favouriteRecipes).values({
          userId: user.id,
          recipeId: r.id,
          recipeType: "community",
          createdAt: IN_RANGE,
        });
      }
      const titles = async () =>
        (await wr.getWeeklyReportInputs(user.id, FROM, TO)).recipes
          .map((r) => r.title)
          .sort();
      expect(await titles()).toEqual(["My private soup", "Their soup"]);
      await tx
        .update(schema.communityRecipes)
        .set({ isPublic: false })
        .where(eq(schema.communityRecipes.id, theirs.id));
      // The user's own private recipe stays (control).
      expect(await titles()).toEqual(["My private soup"]);
    });

    // Audit 2026-11-24 L70: on-device dictation leaves no server trace, so
    // "voice" can never be seen as used; it must not be claimed as unused.
    it("never reports voice as unused, since dictation is not recorded", async () => {
      expect((await wr.getFeatureUsage(user.id)).voice).toBe(true);
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
