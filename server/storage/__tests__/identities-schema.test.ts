import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import { userIdentities, users } from "@shared/schema";
import { eq } from "drizzle-orm";

/** pg puts the violated constraint on the driver error (Drizzle wraps it as `cause`). */
async function constraintOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    const e = err as { constraint?: string; cause?: { constraint?: string } };
    return e.cause?.constraint ?? e.constraint;
  }
  return undefined;
}

describe("identity schema", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("allows a user with a NULL password", async () => {
    const u = await createTestUser(getTestTx(), { password: null });
    expect(u.password).toBeNull();
  });

  it("rejects the same (provider, subject) twice", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    const b = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "google", providerSubject: "sub-1" });
    expect(
      await constraintOf(
        tx.insert(userIdentities).values({
          userId: b.id,
          provider: "google",
          providerSubject: "sub-1",
        }),
      ),
    ).toBe("user_identities_provider_subject_unique");
  });

  it("rejects a second identity of the same provider on one user", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "apple", providerSubject: "s1" });
    expect(
      await constraintOf(
        tx
          .insert(userIdentities)
          .values({ userId: a.id, provider: "apple", providerSubject: "s2" }),
      ),
    ).toBe("user_identities_user_provider_unique");
  });

  it("rejects an unknown provider", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    expect(
      await constraintOf(
        tx
          .insert(userIdentities)
          .values({ userId: a.id, provider: "facebook", providerSubject: "x" }),
      ),
    ).toBe("user_identities_provider_check");
  });

  it("cascades identities when the user is deleted", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "google", providerSubject: "g" });
    await tx.delete(users).where(eq(users.id, a.id));
    const left = await tx
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, a.id));
    expect(left).toHaveLength(0);
  });
});
