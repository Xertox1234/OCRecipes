import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  createTestUserProfile,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { FamilyCardPayload } from "@shared/schemas/coach-write-cards";
import { MAX_FAMILY_PROFILES } from "@shared/types/family";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  addFamilyMemberCardArgsSchema,
  buildFamilyPayload,
  describeFamily,
  performFamilySave,
  revertFamilySave,
} = await import("../family");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const profilesOf = (userId = user.id) =>
  tx
    .select()
    .from(schema.familyProfiles)
    .where(eq(schema.familyProfiles.userId, userId));
const addProfile = (name: string, userId = user.id) =>
  tx.insert(schema.familyProfiles).values({ userId, name, allergies: [] });
const cardFor = (payload: FamilyCardPayload, savedRefs = {}) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "family",
    payload,
    savedRefs,
  });

beforeEach(async () => {
  tx = await setupTestTransaction();
  user = await createTestUser(tx);
  // Family profiles are a paid feature, and the save checks the plan.
  await tx
    .update(schema.users)
    .set({ subscriptionTier: "premium" })
    .where(eq(schema.users.id, user.id));
  await createTestUserProfile(tx, user.id, {
    healthDataConsentAt: new Date(),
  });
});
afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});

describe("addFamilyMemberCardArgsSchema", () => {
  it("takes a name and the common allergens, none by default", () => {
    expect(addFamilyMemberCardArgsSchema.parse({ name: "  Sam " })).toEqual({
      name: "Sam",
      allergens: [],
    });
    expect(
      addFamilyMemberCardArgsSchema.safeParse({
        name: "Sam",
        allergens: ["kiwi"],
      }).success,
    ).toBe(false);
    expect(addFamilyMemberCardArgsSchema.safeParse({ name: "" }).success).toBe(
      false,
    );
  });
});

describe("buildFamilyPayload", () => {
  it("makes the card from the Coach's name and allergens", async () => {
    expect(
      await buildFamilyPayload(
        { name: "Sam", allergens: ["peanuts", "peanuts", "milk"] },
        user.id,
      ),
    ).toEqual({ name: "Sam", allergens: ["peanuts", "milk"] });
  });

  it("does not tell the model a name is taken: that is checked at save", async () => {
    await addProfile("Sam");
    expect(
      await buildFamilyPayload({ name: "sam", allergens: [] }, user.id),
    ).toEqual({ name: "sam", allergens: [] });
  });

  it("refuses a full family", async () => {
    for (let i = 0; i < MAX_FAMILY_PROFILES; i++) await addProfile(`Kid ${i}`);
    await expect(
      buildFamilyPayload({ name: "Sam", allergens: [] }, user.id),
    ).rejects.toMatchObject({ reason: "limit" });
  });

  it("refuses allergies without health-data consent, but not a name alone", async () => {
    const other = await createTestUser(tx, { username: "no_consent_user" });
    await expect(
      buildFamilyPayload({ name: "Sam", allergens: ["milk"] }, other.id),
    ).rejects.toMatchObject({ reason: "consent" });
    expect(
      await buildFamilyPayload({ name: "Sam", allergens: [] }, other.id),
    ).toEqual({ name: "Sam", allergens: [] });
  });
});

describe("performFamilySave", () => {
  const payload: FamilyCardPayload = {
    name: "Sam",
    allergens: ["peanuts", "milk"],
  };

  it("adds the person with the severities the user picked", async () => {
    const refs = await performFamilySave(
      tx,
      cardFor(payload),
      { severities: ["severe", "mild"] },
      { userId: user.id },
    );
    const [row] = await profilesOf();
    expect(row).toMatchObject({
      name: "Sam",
      allergies: [
        { name: "peanuts", severity: "severe" },
        { name: "milk", severity: "mild" },
      ],
      note: null,
    });
    expect(refs).toEqual({
      familyAdded: {
        id: row.id,
        name: "Sam",
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "milk", severity: "mild" },
        ],
      },
    });
  });

  it("refuses a name already in the family, any case, and adds no one", async () => {
    await addProfile("SAM ");
    await expect(
      performFamilySave(
        tx,
        cardFor({ name: "sam", allergens: [] }),
        {},
        { userId: user.id },
      ),
    ).rejects.toThrow(/already in your family/);
    expect(await profilesOf()).toHaveLength(1);
  });

  it.each([
    ["no severities", {}],
    ["a severity not picked yet", { severities: ["severe", null] }],
    ["the wrong number", { severities: ["severe"] }],
    [
      "a field the card does not have",
      { severities: ["mild", "mild"], name: "Tom" },
    ],
  ])("refuses %s and adds no one", async (_name, edits) => {
    await expect(
      performFamilySave(tx, cardFor(payload), edits, { userId: user.id }),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await profilesOf()).toEqual([]);
  });

  it("needs no severity for a person with no allergies", async () => {
    await performFamilySave(
      tx,
      cardFor({ name: "Ana", allergens: [] }),
      {},
      { userId: user.id },
    );
    expect((await profilesOf()).map((p) => p.name)).toEqual(["Ana"]);
  });

  it("refuses a plan that no longer has family profiles", async () => {
    await tx
      .update(schema.users)
      .set({ subscriptionTier: "free" })
      .where(eq(schema.users.id, user.id));
    await expect(
      performFamilySave(
        tx,
        cardFor({ name: "Ana", allergens: [] }),
        {},
        { userId: user.id },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await profilesOf()).toEqual([]);
  });

  it("refuses when the family filled up since the card was made", async () => {
    for (let i = 0; i < MAX_FAMILY_PROFILES; i++) await addProfile(`Kid ${i}`);
    await expect(
      performFamilySave(
        tx,
        cardFor({ name: "Ana", allergens: [] }),
        {},
        { userId: user.id },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("revertFamilySave", () => {
  const added = (id: number) => ({
    familyAdded: {
      id,
      name: "Sam",
      allergies: [{ name: "peanuts", severity: "severe" as const }],
    },
  });
  const insertSam = async (userId = user.id) =>
    (
      await tx
        .insert(schema.familyProfiles)
        .values({
          userId,
          name: "Sam",
          allergies: [{ name: "peanuts", severity: "severe" }],
        })
        .returning()
    )[0];
  const samCard = (refs: object) =>
    cardFor({ name: "Sam", allergens: ["peanuts"] }, refs);

  it("removes the person the card added, for this user only", async () => {
    const mine = await insertSam();
    const other = await createTestUser(tx, { username: "other_family_user" });
    const theirs = await insertSam(other.id);
    await revertFamilySave(tx, samCard(added(theirs.id)));
    expect(await profilesOf(other.id)).toHaveLength(1);
    await revertFamilySave(tx, samCard(added(mine.id)));
    expect(await profilesOf()).toEqual([]);
  });

  it("keeps a person the user has changed since", async () => {
    const mine = await insertSam();
    await tx
      .update(schema.familyProfiles)
      .set({ note: "Loves pasta" })
      .where(eq(schema.familyProfiles.id, mine.id));
    await revertFamilySave(tx, samCard(added(mine.id)));
    expect(await profilesOf()).toHaveLength(1);
  });

  it("keeps a person who already has planned meals", async () => {
    const mine = await insertSam();
    const [recipe] = await tx
      .insert(schema.mealPlanRecipes)
      .values({ userId: user.id, title: "Pasta" })
      .returning();
    await tx.insert(schema.mealPlanItems).values({
      userId: user.id,
      recipeId: recipe.id,
      plannedDate: "2026-11-28",
      mealType: "dinner",
      audience: "profile",
      familyProfileId: mine.id,
    });
    await revertFamilySave(tx, samCard(added(mine.id)));
    expect(await profilesOf()).toHaveLength(1);
  });
});

describe("describeFamily", () => {
  it("names the person and the allergens on the card, never a severity", () => {
    expect(
      describeFamily(
        { name: "Sam", allergens: ["tree_nuts", "milk"] },
        { severities: ["severe", null] },
      ),
    ).toBe("Sam, allergies: tree nuts, milk");
    expect(describeFamily({ name: "Ana", allergens: [] }, {})).toBe(
      "Ana, no allergies",
    );
  });
});
