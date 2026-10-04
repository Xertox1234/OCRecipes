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
import { eq, sql } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { touchLastActive } = await import("../users");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function lastActiveAt(): Promise<Date | null> {
  const [row] = await tx
    .select({ at: users.lastActiveAt })
    .from(users)
    .where(eq(users.id, user.id));
  return row.at;
}

async function setLastActive(minutesAgo: number) {
  await tx
    .update(users)
    .set({
      lastActiveAt: sql`now() - make_interval(mins => ${minutesAgo})`,
    })
    .where(eq(users.id, user.id));
}

describe("touchLastActive", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("sets last_active_at for a user who has none", async () => {
    expect(await lastActiveAt()).toBeNull();

    await touchLastActive(user.id);

    expect(await lastActiveAt()).not.toBeNull();
  });

  it("leaves a value from the last hour unchanged", async () => {
    await setLastActive(30);
    const before = await lastActiveAt();

    await touchLastActive(user.id);

    expect(await lastActiveAt()).toEqual(before);
  });

  it("moves a value older than an hour forward to now", async () => {
    await setLastActive(120);
    const before = await lastActiveAt();

    await touchLastActive(user.id);

    const after = await lastActiveAt();
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
  });
});
