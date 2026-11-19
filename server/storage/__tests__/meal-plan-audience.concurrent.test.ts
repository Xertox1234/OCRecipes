/**
 * Multi-connection race: changing a planned meal to a family profile's meal
 * and confirming it as the user's intake must never both succeed — a
 * profile's meal is never the user's intake (family profiles spec, anti-goal).
 *
 * Like users-subscription.concurrent.test.ts, this file deliberately does NOT
 * mock `../../db` or use `test/db-test-utils` (savepoint isolation forces one
 * connection and cannot race). It commits real rows on the real pool and
 * removes them in `afterAll` (deleting the user cascades the rest).
 *
 * The interleaving is forced, not left to timing: a raw client holds the other
 * side's write uncommitted, the real storage call must BLOCK on it (proving it
 * takes a conflicting row lock), and after the commit it must see the change.
 * The foreign key alone does not serialize the two: the log insert's
 * FOR KEY SHARE does not conflict with an audience UPDATE's FOR NO KEY UPDATE.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import pg from "pg";
import { db, pool } from "../../db";
import {
  dailyLogs,
  familyProfiles,
  mealPlanItems,
  mealPlanRecipes,
  users,
} from "@shared/schema";
import {
  createMealPlanConfirmLog,
  updateMealPlanItemAudience,
} from "../meal-plan-items";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

async function createPlannedMeal() {
  const [user] = await db
    .insert(users)
    .values({
      username: `audience_race_${crypto.randomUUID()}`,
      email: `audience_race_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  const [recipe] = await db
    .insert(mealPlanRecipes)
    .values({ userId: user.id, title: "Race stew" })
    .returning({ id: mealPlanRecipes.id });
  const [profile] = await db
    .insert(familyProfiles)
    .values({ userId: user.id, name: "Sam" })
    .returning({ id: familyProfiles.id });
  const [item] = await db
    .insert(mealPlanItems)
    .values({
      userId: user.id,
      recipeId: recipe.id,
      plannedDate: "2026-11-18",
      mealType: "dinner",
    })
    .returning({ id: mealPlanItems.id });
  return {
    userId: user.id,
    recipeId: recipe.id,
    profileId: profile.id,
    itemId: item.id,
  };
}

/** Resolve once some backend is blocked by `blockerPid`; returns its pid. */
async function waitForBlockedBy(
  client: pg.Client,
  blockerPid: number,
): Promise<number> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query<{ pid: number }>(
      "SELECT pid FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))",
      [blockerPid],
    );
    if (rows.length > 0) return rows[0].pid;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`no backend became blocked by pid ${blockerPid}`);
}

async function withBlocker(
  run: (blocker: pg.Client, observer: pg.Client, pid: number) => Promise<void>,
) {
  const blocker = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const observer = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await blocker.connect();
  await observer.connect();
  try {
    const {
      rows: [{ pid }],
    } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await run(blocker, observer, pid);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    await blocker.end();
    await observer.end();
  }
}

describe("meal plan audience vs confirm — concurrent multi-connection safety", () => {
  it("a change to a profile's meal waits for an in-flight confirm, then is refused", async () => {
    const meal = await createPlannedMeal();
    await withBlocker(async (blocker, observer, blockerPid) => {
      // The confirm's log insert, not yet committed.
      await blocker.query("BEGIN");
      await blocker.query(
        `INSERT INTO daily_logs (user_id, recipe_id, meal_plan_item_id, source, servings, meal_type)
         VALUES ($1, $2, $3, 'meal_plan_confirm', 1, 'dinner')`,
        [meal.userId, meal.recipeId, meal.itemId],
      );

      const change = updateMealPlanItemAudience(
        meal.itemId,
        meal.userId,
        "profile",
        meal.profileId,
      );
      await waitForBlockedBy(observer, blockerPid);
      await blocker.query("COMMIT");

      expect(await change).toBe("confirmed");
      const [item] = await db
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, meal.itemId));
      expect(item.audience).toBe("self");
      expect(item.familyProfileId).toBeNull();
    });
  }, 20_000);

  it("a confirm waits for an in-flight change to a profile's meal, then is refused", async () => {
    const meal = await createPlannedMeal();
    await withBlocker(async (blocker, observer, blockerPid) => {
      // The audience change, not yet committed.
      await blocker.query("BEGIN");
      await blocker.query(
        "UPDATE meal_plan_items SET audience = 'profile', family_profile_id = $1 WHERE id = $2",
        [meal.profileId, meal.itemId],
      );

      const confirm = createMealPlanConfirmLog(meal.itemId, meal.userId);
      await waitForBlockedBy(observer, blockerPid);
      await blocker.query("COMMIT");

      expect(await confirm).toEqual({ status: "profile" });
      const logs = await db
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.mealPlanItemId, meal.itemId));
      expect(logs).toHaveLength(0);
    });
  }, 20_000);

  it("confirms an unclaimed meal and refuses another user's item", async () => {
    const meal = await createPlannedMeal();
    const other = await createPlannedMeal();

    expect(await createMealPlanConfirmLog(meal.itemId, other.userId)).toEqual({
      status: "not_found",
    });
    expect(
      await updateMealPlanItemAudience(
        meal.itemId,
        other.userId,
        "shared",
        null,
      ),
    ).toBeUndefined();

    const result = await createMealPlanConfirmLog(meal.itemId, meal.userId);
    expect(result.status).toBe("created");
    if (result.status === "created") {
      expect(result.log.mealPlanItemId).toBe(meal.itemId);
      expect(result.log.source).toBe("meal_plan_confirm");
    }
    // A meal already counted cannot become a profile's; shared still can.
    expect(
      await updateMealPlanItemAudience(
        meal.itemId,
        meal.userId,
        "profile",
        meal.profileId,
      ),
    ).toBe("confirmed");
    const shared = await updateMealPlanItemAudience(
      meal.itemId,
      meal.userId,
      "shared",
      null,
    );
    expect(shared).toMatchObject({ audience: "shared" });
  }, 20_000);
});
