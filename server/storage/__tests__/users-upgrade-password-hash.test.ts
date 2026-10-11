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
import type * as schema from "@shared/schema";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const users_ = await import("../users");

let tx: NodePgDatabase<typeof schema>;

describe("upgradePasswordHash", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("swaps only when the stored hash is still the one that was checked", async () => {
    const user = await createTestUser(tx, { password: "LEGACY_HASH" });
    expect(
      await users_.upgradePasswordHash(user.id, "LEGACY_HASH", "pv2$new"),
    ).toBe(true);
    expect((await users_.getUserForAuth(user.id))?.password).toBe("pv2$new");
  });

  it("loses to a concurrent change: never restores the old password", async () => {
    const user = await createTestUser(tx, { password: "LEGACY_HASH" });
    await tx
      .update(users)
      .set({ password: "pv2$reset" })
      .where(eq(users.id, user.id));
    expect(
      await users_.upgradePasswordHash(user.id, "LEGACY_HASH", "pv2$rehash"),
    ).toBe(false);
    expect((await users_.getUserForAuth(user.id))?.password).toBe("pv2$reset");
  });
});
