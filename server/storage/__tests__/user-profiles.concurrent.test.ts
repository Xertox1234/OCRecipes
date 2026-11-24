/**
 * Multi-connection tests for the transactions that write both `users` and
 * `user_profiles`. Like `coach-write-cards.concurrent.test.ts`, this does NOT
 * mock `../../db`: the savepoint harness forces one connection, which cannot
 * race. Rows are committed and removed in `afterAll`.
 *
 * A goals save updates `users` and then `user_profiles`. A transaction that
 * takes the two in the other order deadlocks with it, and Postgres aborts one
 * of the two. Every such transaction must take the `users` row first.
 *
 * Each test holds the profile row from a third connection so the interleaving
 * is the same on every run: the transaction under test queues for the profile
 * first, the goals save takes `users` and queues behind it, then the row is
 * let go.
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, userProfiles } from "@shared/schema";
import { updateUserGoalsAndProfile } from "../users";
import {
  upsertProfileWithOnboarding,
  withdrawHealthConsent,
} from "../user-profiles";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createUserWithProfile(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `profile_concurrent_${crypto.randomUUID()}`,
      email: `profile_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  await db
    .insert(userProfiles)
    .values({ userId: user.id, healthDataConsentAt: new Date() });
  return user.id;
}

/**
 * Runs `first`, then a goals save, while a third connection holds the profile
 * row; returns how the two ended once the row is let go.
 */
async function raceAgainstGoalsSave(
  userId: string,
  first: () => Promise<unknown>,
) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let profileHeld!: () => void;
  const profileIsHeld = new Promise<void>((r) => (profileHeld = r));

  const holder = db.transaction(async (tx) => {
    await tx
      .select({ id: userProfiles.id })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .for("update");
    profileHeld();
    await released;
  });
  await profileIsHeld;

  const firstRun = first();
  // Long enough for it to reach the held profile row.
  await sleep(300);
  const goalsSave = updateUserGoalsAndProfile(
    userId,
    { dailyCalorieGoal: 2100 },
    { activityLevel: "moderate" },
  );
  // Long enough for the goals save to take `users` and queue for the profile.
  await sleep(300);
  release();
  await holder;

  return Promise.allSettled([firstRun, goalsSave]);
}

describe("users + user_profiles writers: concurrent multi-connection safety", () => {
  it("a consent withdrawal and a goals save both finish", async () => {
    const userId = await createUserWithProfile();

    const results = await raceAgainstGoalsSave(userId, () =>
      withdrawHealthConsent(userId),
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("an onboarding save and a goals save both finish", async () => {
    const userId = await createUserWithProfile();

    const results = await raceAgainstGoalsSave(userId, () =>
      upsertProfileWithOnboarding(userId, { activityLevel: "light" }),
    );

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const [user] = await db
      .select({ onboardingCompleted: users.onboardingCompleted })
      .from(users)
      .where(eq(users.id, userId));
    expect(user.onboardingCompleted).toBe(true);
  });
});
