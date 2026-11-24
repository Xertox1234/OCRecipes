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
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { AllergyCardPayload } from "@shared/schemas/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { buildAllergyPayload, performAllergySave, revertAllergySave } =
  await import("../allergy");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const setProfile = async (
  allergies: schema.Allergy[],
  consent: Date | null = new Date(),
) => {
  await tx
    .insert(schema.userProfiles)
    .values({ userId: user.id, allergies, healthDataConsentAt: consent })
    .onConflictDoUpdate({
      target: schema.userProfiles.userId,
      set: { allergies, healthDataConsentAt: consent },
    });
};
const allergiesOf = async () =>
  (
    await tx
      .select({ allergies: schema.userProfiles.allergies })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, user.id))
  )[0].allergies;
const payload: AllergyCardPayload = { allergen: "shellfish" };
const cardFor = (savedRefs = {}) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "allergy",
    payload,
    savedRefs,
  });
const ctx = () => ({ userId: user.id, afterCommit: vi.fn() });

beforeEach(async () => {
  tx = await setupTestTransaction();
  user = await createTestUser(tx);
  await setProfile([{ name: "milk", severity: "mild" }]);
});
afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});

describe("buildAllergyPayload", () => {
  it("makes a card for an allergen the profile does not list", async () => {
    expect(
      await buildAllergyPayload({ allergen: "shellfish" }, user.id),
    ).toEqual({ allergen: "shellfish" });
  });

  it("refuses an allergen already on file", async () => {
    await expect(
      buildAllergyPayload({ allergen: "milk" }, user.id),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("refuses a user who has not agreed to store health data", async () => {
    await setProfile([], null);
    await expect(
      buildAllergyPayload({ allergen: "shellfish" }, user.id),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("refuses a user with no profile row", async () => {
    await tx
      .delete(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, user.id));
    await expect(
      buildAllergyPayload({ allergen: "shellfish" }, user.id),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("performAllergySave", () => {
  it("adds the allergen with the severity the user picked, keeping the others", async () => {
    const c = ctx();
    const refs = await performAllergySave(
      tx,
      cardFor(),
      { severity: "severe" },
      c,
    );
    expect(await allergiesOf()).toEqual([
      { name: "milk", severity: "mild" },
      { name: "shellfish", severity: "severe" },
    ]);
    expect(refs).toEqual({
      allergyAdded: { name: "shellfish", severity: "severe" },
    });
    expect(c.afterCommit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no severity", {}],
    ["an unknown severity", { severity: "deadly" }],
    ["an allergen of the app's own", { severity: "mild", allergen: "fish" }],
  ])("refuses %s and writes nothing", async (_name, edits) => {
    await expect(
      performAllergySave(tx, cardFor(), edits, ctx()),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await allergiesOf()).toHaveLength(1);
  });

  it("refuses when the allergen was added elsewhere since the card was built", async () => {
    await setProfile([{ name: "shellfish", severity: "mild" }]);
    await expect(
      performAllergySave(tx, cardFor(), { severity: "severe" }, ctx()),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await allergiesOf()).toEqual([
      { name: "shellfish", severity: "mild" },
    ]);
  });

  it("refuses when the health-data consent was withdrawn since", async () => {
    await setProfile([], null);
    await expect(
      performAllergySave(tx, cardFor(), { severity: "severe" }, ctx()),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await allergiesOf()).toEqual([]);
  });

  it("refuses when the profile already holds 30 allergies", async () => {
    await setProfile(
      Array.from({ length: 30 }, (_, i) => ({
        name: `other-${i}`,
        severity: "mild" as const,
      })),
    );
    await expect(
      performAllergySave(tx, cardFor(), { severity: "severe" }, ctx()),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("revertAllergySave", () => {
  const saved = { allergyAdded: { name: "shellfish", severity: "severe" } };

  it("removes the allergy the card added", async () => {
    await setProfile([
      { name: "milk", severity: "mild" },
      { name: "shellfish", severity: "severe" },
    ]);
    const afterCommit = vi.fn();
    await revertAllergySave(tx, cardFor(saved), afterCommit);
    expect(await allergiesOf()).toEqual([{ name: "milk", severity: "mild" }]);
    expect(afterCommit).toHaveBeenCalledTimes(1);
  });

  it("leaves an allergy whose severity the user has changed since", async () => {
    await setProfile([{ name: "shellfish", severity: "mild" }]);
    await revertAllergySave(tx, cardFor(saved), vi.fn());
    expect(await allergiesOf()).toEqual([
      { name: "shellfish", severity: "mild" },
    ]);
  });
});
