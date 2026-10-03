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

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const users_ = await import("../users");

const RESET_KEYS = [
  "resetCodeHash",
  "resetCodeExpiresAt",
  "resetCodeAttempts",
  "resetIssueCount",
  "resetIssueWindowStart",
] as const;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("password reset storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("SafeUser never carries reset columns", () => {
    it("getUser omits all five reset keys", async () => {
      const u = await users_.getUser(testUser.id);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
    it("getUserByEmail omits all five reset keys", async () => {
      const u = await users_.getUserByEmail(testUser.email);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
  });
});
