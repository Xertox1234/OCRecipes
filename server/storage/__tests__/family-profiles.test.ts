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
import { eq } from "drizzle-orm";
import * as schema from "@shared/schema";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getFamilyProfiles,
  getFamilyProfile,
  countFamilyProfiles,
  createFamilyProfile,
  updateFamilyProfile,
  deleteFamilyProfile,
  clearFamilyHealthData,
} = await import("../family-profiles");
const { getUserDataExport } = await import("../export");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
let otherUser: schema.User;

const input = (name: string, extra: Partial<{ note: string | null }> = {}) => ({
  name,
  allergies: [{ name: "peanut", severity: "severe" as const }],
  note: extra.note ?? null,
});

async function seedRecipe(userId: string): Promise<number> {
  const [row] = await tx
    .insert(schema.mealPlanRecipes)
    .values({ userId, title: "Seed recipe" })
    .returning();
  return row.id;
}

async function seedProfile(userId: string, name = "Kid") {
  const created = await createFamilyProfile(userId, input(name));
  if (created === "limit") throw new Error("unexpected limit");
  return created;
}

describe("family profiles storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
    otherUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("create and list", () => {
    it("lists a created profile and keeps another user's list empty", async () => {
      const created = await seedProfile(testUser.id, "Mia");
      expect(created.name).toBe("Mia");
      expect(created.userId).toBe(testUser.id);
      expect(created.allergies).toEqual([
        { name: "peanut", severity: "severe" },
      ]);

      const mine = await getFamilyProfiles(testUser.id);
      expect(mine.map((p) => p.id)).toEqual([created.id]);
      expect(await getFamilyProfiles(otherUser.id)).toEqual([]);
      expect(await countFamilyProfiles(testUser.id)).toBe(1);
      expect(await countFamilyProfiles(otherUser.id)).toBe(0);
    });

    it("lists in creation order", async () => {
      const a = await seedProfile(testUser.id, "A");
      const b = await seedProfile(testUser.id, "B");
      const c = await seedProfile(testUser.id, "C");
      const list = await getFamilyProfiles(testUser.id);
      expect(list.map((p) => p.id)).toEqual([a.id, b.id, c.id]);
      expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
      expect(c.sortOrder).toBeGreaterThan(b.sortOrder);
    });

    it("returns 'limit' for the ninth profile and keeps the count at 8", async () => {
      for (let i = 0; i < MAX_FAMILY_PROFILES; i++) {
        await seedProfile(testUser.id, `P${i}`);
      }
      expect(await createFamilyProfile(testUser.id, input("Ninth"))).toBe(
        "limit",
      );
      expect(await countFamilyProfiles(testUser.id)).toBe(8);
      // Another user is unaffected by this user's cap.
      expect(await createFamilyProfile(otherUser.id, input("Fine"))).not.toBe(
        "limit",
      );
    });
  });

  describe("getFamilyProfile", () => {
    it("returns the profile for its owner", async () => {
      const created = await seedProfile(testUser.id);
      const found = await getFamilyProfile(created.id, testUser.id);
      expect(found?.id).toBe(created.id);
    });

    it("returns undefined for the wrong user", async () => {
      const created = await seedProfile(testUser.id);
      expect(await getFamilyProfile(created.id, otherUser.id)).toBeUndefined();
    });
  });

  describe("updateFamilyProfile", () => {
    it("updates name, allergies and note for the owner", async () => {
      const created = await seedProfile(testUser.id);
      const updated = await updateFamilyProfile(created.id, testUser.id, {
        name: "Renamed",
        allergies: [],
        note: "no spice",
      });
      expect(updated).toMatchObject({
        id: created.id,
        name: "Renamed",
        allergies: [],
        note: "no spice",
      });
    });

    it("returns undefined and changes nothing for the wrong user", async () => {
      const created = await seedProfile(testUser.id, "Original");
      const result = await updateFamilyProfile(created.id, otherUser.id, {
        name: "Hijacked",
        allergies: [],
        note: "x",
      });
      expect(result).toBeUndefined();
      const after = await getFamilyProfile(created.id, testUser.id);
      expect(after?.name).toBe("Original");
      expect(after?.allergies).toHaveLength(1);
      expect(after?.note).toBeNull();
    });
  });

  describe("deleteFamilyProfile", () => {
    it("returns false and deletes nothing for the wrong user", async () => {
      const created = await seedProfile(testUser.id);
      expect(await deleteFamilyProfile(created.id, otherUser.id)).toBe(false);
      expect(await getFamilyProfile(created.id, testUser.id)).toBeDefined();
    });

    it("deletes the profile's meal and keeps a shared meal on the same day", async () => {
      const profile = await seedProfile(testUser.id);
      const recipeId = await seedRecipe(testUser.id);
      const base = {
        userId: testUser.id,
        recipeId,
        plannedDate: "2026-11-20",
        mealType: "dinner",
      };
      await tx.insert(schema.mealPlanItems).values({
        ...base,
        audience: "profile",
        familyProfileId: profile.id,
      });
      await tx
        .insert(schema.mealPlanItems)
        .values({ ...base, audience: "shared" });

      expect(await deleteFamilyProfile(profile.id, testUser.id)).toBe(true);
      expect(await getFamilyProfile(profile.id, testUser.id)).toBeUndefined();

      const meals = await tx
        .select()
        .from(schema.mealPlanItems)
        .where(eq(schema.mealPlanItems.userId, testUser.id));
      expect(meals.map((m) => m.audience)).toEqual(["shared"]);
    });
  });

  describe("meal audience constraints in the database", () => {
    it("rejects a profile meal that points at another user's profile", async () => {
      const theirs = await seedProfile(otherUser.id);
      const recipeId = await seedRecipe(testUser.id);
      await expect(
        tx.insert(schema.mealPlanItems).values({
          userId: testUser.id,
          recipeId,
          plannedDate: "2026-11-20",
          mealType: "dinner",
          audience: "profile",
          familyProfileId: theirs.id,
        }),
      ).rejects.toThrow();
    });

    it("rejects a shared meal that carries a profile id", async () => {
      const mine = await seedProfile(testUser.id);
      const recipeId = await seedRecipe(testUser.id);
      await expect(
        tx.insert(schema.mealPlanItems).values({
          userId: testUser.id,
          recipeId,
          plannedDate: "2026-11-20",
          mealType: "dinner",
          audience: "shared",
          familyProfileId: mine.id,
        }),
      ).rejects.toThrow();
    });

    it("rejects a profile meal without a profile id", async () => {
      const recipeId = await seedRecipe(testUser.id);
      await expect(
        tx.insert(schema.mealPlanItems).values({
          userId: testUser.id,
          recipeId,
          plannedDate: "2026-11-20",
          mealType: "dinner",
          audience: "profile",
          familyProfileId: null,
        }),
      ).rejects.toThrow();
    });
  });

  describe("clearFamilyHealthData", () => {
    it("empties allergies and note for this user's profiles only and keeps names", async () => {
      const a = await createFamilyProfile(
        testUser.id,
        input("Alice", { note: "n1" }),
      );
      const b = await createFamilyProfile(
        testUser.id,
        input("Bob", { note: "n2" }),
      );
      const theirs = await createFamilyProfile(
        otherUser.id,
        input("Carol", { note: "n3" }),
      );
      expect(a).not.toBe("limit");
      expect(b).not.toBe("limit");
      expect(theirs).not.toBe("limit");

      await clearFamilyHealthData(testUser.id, tx);

      const mine = await getFamilyProfiles(testUser.id);
      expect(mine.map((p) => p.name)).toEqual(["Alice", "Bob"]);
      for (const p of mine) {
        expect(p.allergies).toEqual([]);
        expect(p.note).toBeNull();
      }
      const [other] = await getFamilyProfiles(otherUser.id);
      expect(other.name).toBe("Carol");
      expect(other.allergies).toHaveLength(1);
      expect(other.note).toBe("n3");
    });
  });

  describe("data export", () => {
    it("contains the user's profiles and no one else's", async () => {
      const mine = await seedProfile(testUser.id, "Mine");
      await seedProfile(otherUser.id, "Theirs");
      const exported = await getUserDataExport(testUser.id);
      expect(exported.familyProfiles.map((p) => p.id)).toEqual([mine.id]);
    });
  });
});
